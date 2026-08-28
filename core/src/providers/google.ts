import type { FinishReason, ProviderAdapter, ProviderChatArgs, ProviderResult } from "../types.js";
import { CitationCollector } from "./citations.js";
import { describeNetworkError, readStreamLines, throwHttpError } from "./sse.js";
import { imageAttachments, inlineTextAttachments } from "./attachments.js";

export const google: ProviderAdapter = {
  id: "google",
  label: "Google Gemini",
  async chat(args: ProviderChatArgs): Promise<ProviderResult> {
    const { model, apiKey, baseUrl, system, messages, maxOutputTokens, signal, handlers, webSearch } = args;
    if (!apiKey) throw new Error("Google Gemini requires an API key — add one in this agent's properties.");
    const base = (baseUrl || "https://generativelanguage.googleapis.com").replace(/\/+$/, "");
    const url =
      `${base}/v1beta/models/` + `${encodeURIComponent(model)}:streamGenerateContent?alt=sse`;
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        signal,
        headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: messages.map((m) => ({
            role: m.role === "assistant" ? "model" : "user",
            parts: [
              { text: inlineTextAttachments(m) },
              ...imageAttachments(m).map((img) => ({
                inlineData: { mimeType: img.mime, data: img.data },
              })),
            ],
          })),
          generationConfig: { maxOutputTokens },
          // Grounding with Google Search. The model decides whether a search
          // would help, runs it, and cites what it used.
          ...(webSearch ? { tools: [{ google_search: {} }] } : {}),
        }),
      });
    } catch (err) {
      throw describeNetworkError(err, "Google Gemini", url);
    }
    if (!res.ok || !res.body) await throwHttpError(res, "Google Gemini", url);

    let text = "";
    let inputTokens = 0;
    let outputTokens = 0;
    let finishReason: FinishReason | undefined;
    const sources = new CitationCollector();
    for await (const data of readStreamLines(res.body!, "sse")) {
      let event: any;
      try {
        event = JSON.parse(data);
      } catch {
        continue;
      }
      const parts = event.candidates?.[0]?.content?.parts;
      if (Array.isArray(parts)) {
        for (const part of parts) {
          if (typeof part.text === "string" && part.text.length > 0) {
            text += part.text;
            await handlers.onToken(part.text);
          }
        }
      }
      // Grounding metadata names the pages the answer was built from.
      const chunks = event.candidates?.[0]?.groundingMetadata?.groundingChunks;
      if (Array.isArray(chunks)) {
        for (const chunk of chunks) sources.add(chunk?.web?.uri, chunk?.web?.title);
      }
      const reason = event.candidates?.[0]?.finishReason;
      if (reason) {
        finishReason =
          reason === "MAX_TOKENS"
            ? "length"
            : reason === "SAFETY" || reason === "RECITATION" || reason === "PROHIBITED_CONTENT"
              ? "filtered"
              : reason === "STOP"
                ? "stop"
                : "unknown";
      }
      if (event.usageMetadata) {
        inputTokens = event.usageMetadata.promptTokenCount ?? inputTokens;
        outputTokens = event.usageMetadata.candidatesTokenCount ?? outputTokens;
      }
    }
    return { text, usage: { inputTokens, outputTokens }, finishReason, citations: sources.list() };
  },
};

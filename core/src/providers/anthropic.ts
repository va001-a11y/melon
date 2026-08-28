import type { FinishReason, ProviderAdapter, ProviderChatArgs, ProviderResult } from "../types.js";
import { CitationCollector } from "./citations.js";
import { describeNetworkError, readStreamLines, throwHttpError } from "./sse.js";
import { imageAttachments, inlineTextAttachments } from "./attachments.js";

export const anthropic: ProviderAdapter = {
  id: "anthropic",
  label: "Anthropic",
  async chat(args: ProviderChatArgs): Promise<ProviderResult> {
    const { model, apiKey, baseUrl, system, messages, maxOutputTokens, signal, handlers, webSearch } = args;
    if (!apiKey) throw new Error("Anthropic requires an API key — add one in this agent's properties.");
    const base = (baseUrl || "https://api.anthropic.com").replace(/\/+$/, "").replace(/\/v1$/, "");
    const url = `${base}/v1/messages`;
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        signal,
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          /*
           * Anthropic refuses cross-origin browser requests unless the caller
           * opts in with this header, which exists to make the tradeoff
           * explicit: calling the API from a page means the key lives in that
           * page. That is already how Melon works — keys are the user's own
           * and never leave their browser except to the provider — so the
           * header states a fact rather than adding risk.
           *
           * Sent only from a browser. On the desktop build the request
           * originates from the local Node process, where it means nothing.
           */
          ...(typeof window === "undefined" ? {} : { "anthropic-dangerous-direct-browser-access": "true" }),
        },
        body: JSON.stringify({
          model,
          system,
          max_tokens: maxOutputTokens,
          stream: true,
          /*
           * Anthropic runs the search on its own servers and folds the results
           * into the reply, so there is no tool loop for us to drive. max_uses
           * caps it: each search is billed on top of tokens, and an agent left
           * unbounded can run several per answer.
           */
          ...(webSearch ? { tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }] } : {}),
          messages: messages.map((m) => {
            const text = inlineTextAttachments(m);
            const images = imageAttachments(m);
            if (images.length === 0) return { role: m.role, content: text };
            return {
              role: m.role,
              content: [
                ...images.map((img) => ({
                  type: "image",
                  source: { type: "base64", media_type: img.mime, data: img.data },
                })),
                { type: "text", text },
              ],
            };
          }),
        }),
      });
    } catch (err) {
      throw describeNetworkError(err, "Anthropic", url);
    }
    if (!res.ok || !res.body) await throwHttpError(res, "Anthropic", url);

    let text = "";
    let inputTokens = 0;
    let outputTokens = 0;
    let finishReason: FinishReason | undefined;
    const sources = new CitationCollector();
    for await (const data of readStreamLines(res.body!, "sse")) {
      if (data === "[DONE]") break;
      let event: any;
      try {
        event = JSON.parse(data);
      } catch {
        continue;
      }
      switch (event.type) {
        case "message_start":
          inputTokens = event.message?.usage?.input_tokens ?? 0;
          break;
        case "content_block_start": {
          // The tool-result block lists everything the search returned,
          // including pages the answer ends up not quoting.
          const block = event.content_block;
          if (block?.type === "web_search_tool_result" && Array.isArray(block.content)) {
            for (const r of block.content) sources.add(r?.url, r?.title);
          }
          for (const c of block?.citations ?? []) sources.add(c?.url, c?.title);
          break;
        }
        case "content_block_delta":
          if (event.delta?.type === "text_delta" && event.delta.text) {
            text += event.delta.text;
            await handlers.onToken(event.delta.text);
          }
          // Citations arrive attached to the sentence they support.
          if (event.delta?.type === "citations_delta") {
            const c = event.delta.citation;
            sources.add(c?.url, c?.title);
          }
          break;
        case "message_delta": {
          outputTokens = event.usage?.output_tokens ?? outputTokens;
          const stop = event.delta?.stop_reason;
          if (stop) {
            finishReason = stop === "max_tokens" ? "length" : stop === "refusal" ? "filtered" : "stop";
          }
          break;
        }
        case "error":
          throw new Error(`Anthropic stream error: ${event.error?.message ?? "unknown"}`);
      }
    }
    return { text, usage: { inputTokens, outputTokens }, finishReason, citations: sources.list() };
  },
};

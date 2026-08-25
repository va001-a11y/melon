import type { FinishReason, ProviderAdapter, ProviderChatArgs, ProviderResult } from "../types.js";
import { describeNetworkError, fetchLocalAware, readStreamLines, throwHttpError } from "./sse.js";
import { imageAttachments, inlineTextAttachments } from "./attachments.js";

const DEFAULT_BASE = "http://127.0.0.1:11434";

/** Ollama speaks its own API at /api/chat and streams NDJSON, not SSE. */
export const ollama: ProviderAdapter = {
  id: "ollama",
  label: "Ollama",
  async chat(args: ProviderChatArgs): Promise<ProviderResult> {
    const { model, baseUrl, system, messages, maxOutputTokens, signal, handlers } = args;
    // Tolerate a pasted OpenAI-style URL: /v1 and /api are not part of the root.
    const base = (baseUrl || DEFAULT_BASE).replace(/\/+$/, "").replace(/\/(v1|api)$/i, "");
    const requestUrl = `${base}/api/chat`;

    let res: Response;
    let url = requestUrl;
    try {
      const attempt = await fetchLocalAware(requestUrl, {
        method: "POST",
        signal,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model,
          stream: true,
          options: { num_predict: maxOutputTokens },
          messages: [
            { role: "system", content: system },
            // Ollama takes images as a parallel array of base64 strings.
            ...messages.map((m) => {
              const images = imageAttachments(m);
              return images.length > 0
                ? { role: m.role, content: inlineTextAttachments(m), images: images.map((i) => i.data) }
                : { role: m.role, content: inlineTextAttachments(m) };
            }),
          ],
        }),
      });
      res = attempt.res;
      url = attempt.url;
    } catch (err) {
      throw describeNetworkError(err, "Ollama", requestUrl);
    }
    if (!res.ok || !res.body) await throwHttpError(res, "Ollama", url);

    let text = "";
    let inputTokens = 0;
    let outputTokens = 0;
    let finishReason: FinishReason | undefined;
    for await (const line of readStreamLines(res.body!, "ndjson")) {
      let event: any;
      try {
        event = JSON.parse(line);
      } catch {
        continue;
      }
      if (event.error) {
        const missing = /not found|no such model/i.test(String(event.error));
        throw new Error(
          missing
            ? `Ollama does not have the model "${model}" — run: ollama pull ${model}`
            : `Ollama: ${event.error}`
        );
      }
      const chunk = event.message?.content;
      if (typeof chunk === "string" && chunk.length > 0) {
        text += chunk;
        await handlers.onToken(chunk);
      }
      if (event.done) {
        inputTokens = event.prompt_eval_count ?? 0;
        outputTokens = event.eval_count ?? 0;
        // Ollama reports "length" when num_predict cut the reply short.
        finishReason = event.done_reason === "length" ? "length" : "stop";
      }
    }
    return { text, usage: { inputTokens, outputTokens }, finishReason };
  },
};

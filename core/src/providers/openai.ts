import type { FinishReason, ProviderAdapter, ProviderChatArgs, ProviderResult } from "../types.js";
import { describeNetworkError, fetchLocalAware, readStreamLines, throwHttpError } from "./sse.js";
import { imageAttachments, inlineTextAttachments } from "./attachments.js";

/**
 * The OpenAI /chat/completions protocol — spoken by OpenAI itself and by
 * most of the industry (Perplexity, Mistral, Groq, NVIDIA NIM, Moonshot,
 * OpenRouter, DeepSeek, LM Studio, vLLM, …). The base URL decides who.
 */
export const openai: ProviderAdapter = {
  id: "openai",
  label: "OpenAI-compatible",
  async chat(args: ProviderChatArgs): Promise<ProviderResult> {
    const { model, apiKey, baseUrl, providerLabel, providerId, system, messages, maxOutputTokens, signal, handlers, webSearch } = args;
    const base = (baseUrl ?? "https://api.openai.com/v1").replace(/\/+$/, "");
    const requestUrl = `${base}/chat/completions`;
    let url = requestUrl;
    const label = providerLabel ?? "OpenAI-compatible";

    // Text files are inlined; images become image_url parts with data URIs.
    const wireMessages = messages.map((m) => {
      const text = inlineTextAttachments(m);
      const images = imageAttachments(m);
      if (images.length === 0) return { role: m.role, content: text };
      return {
        role: m.role,
        content: [
          { type: "text", text },
          ...images.map((img) => ({
            type: "image_url",
            image_url: { url: `data:${img.mime};base64,${img.data}` },
          })),
        ],
      };
    });

    const body: Record<string, unknown> = {
      model,
      stream: true,
      max_tokens: maxOutputTokens,
      // Without this, streaming responses carry no usage and every reply
      // reports 0/0 tokens. Dropped automatically if a provider rejects it.
      stream_options: { include_usage: true },
      messages: [{ role: "system", content: system }, ...wireMessages],
    };

    const headers: Record<string, string> = { "content-type": "application/json" };
    if (apiKey) headers.authorization = `Bearer ${apiKey}`;

    const payload = JSON.stringify(body);
    const payloadKb = Math.round(payload.length / 1024);

    let res: Response;
    try {
      const attempt = await fetchLocalAware(requestUrl, { method: "POST", signal, headers, body: payload });
      res = attempt.res;
      url = attempt.url;
    } catch (err) {
      throw describeNetworkError(err, label, requestUrl);
    }

    // Some providers reject stream_options, and newer OpenAI models want
    // max_completion_tokens instead of max_tokens. Retry without either.
    if (res.status === 400) {
      const retry = { ...body };
      delete retry.stream_options;
      delete retry.max_tokens;
      retry.max_completion_tokens = maxOutputTokens;
      try {
        const second = await fetch(url, { method: "POST", signal, headers, body: JSON.stringify(retry) });
        if (second.ok) res = second;
      } catch {
        /* keep the original failure */
      }
    }

    // Report the real size, so "too large" is a measurement, not a guess.
    if (res.status === 413) {
      throw new Error(
        `${label} rejected the request as too large (413). Melon sent ${payloadKb} KB ` +
          `(~${Math.ceil(payload.length / 4).toLocaleString()} tokens, ${wireMessages.length} messages). ` +
          `Press Reset to clear this chat, start a new one, or remove any attachment.`
      );
    }
    if (!res.ok || !res.body) await throwHttpError(res, label, url);

    let text = "";
    let inputTokens = 0;
    let outputTokens = 0;
    let finishReason: FinishReason | undefined;
    for await (const data of readStreamLines(res.body!, "sse")) {
      if (data === "[DONE]") break;
      let event: any;
      try {
        event = JSON.parse(data);
      } catch {
        continue;
      }
      if (event.error) {
        const detail = event.error.message ?? JSON.stringify(event.error);
        // Providers can report an oversized request mid-stream too.
        if (/entity too large|payload too large|too many tokens|context length/i.test(String(detail))) {
          throw new Error(
            `${label}: ${detail}. Melon sent ${payloadKb} KB (~${Math.ceil(payload.length / 4).toLocaleString()} ` +
              `tokens, ${wireMessages.length} messages). Press Reset to clear this chat, start a new one, or ` +
              `remove any attachment.`
          );
        }
        throw new Error(`${label}: ${detail}`);
      }
      const delta = event.choices?.[0]?.delta?.content;
      if (typeof delta === "string" && delta.length > 0) {
        text += delta;
        await handlers.onToken(delta);
      }
      const reason = event.choices?.[0]?.finish_reason;
      if (reason) {
        finishReason =
          reason === "length"
            ? "length"
            : reason === "content_filter"
              ? "filtered"
              : reason === "stop"
                ? "stop"
                : "unknown";
      }
      if (event.usage) {
        inputTokens = event.usage.prompt_tokens ?? inputTokens;
        outputTokens = event.usage.completion_tokens ?? outputTokens;
      }
    }
    return { text, usage: { inputTokens, outputTokens }, finishReason };
  },
};

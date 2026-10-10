import type { FinishReason, ProviderAdapter, ProviderChatArgs, ProviderResult } from "../types.js";
import { CitationCollector } from "./citations.js";
import { describeNetworkError, fetchLocalAware, readStreamLines, throwHttpError } from "./sse.js";
import { imageAttachments, inlineTextAttachments } from "./attachments.js";
import { COT_END, COT_START } from "../prompts.js";

/**
 * The OpenAI /chat/completions protocol — spoken by OpenAI itself and by
 * most of the industry (Perplexity, Mistral, Groq, NVIDIA NIM, Moonshot,
 * OpenRouter, DeepSeek, LM Studio, vLLM, …). The base URL decides who.
 */
export const openai: ProviderAdapter = {
  id: "openai",
  label: "OpenAI-compatible",
  async chat(args: ProviderChatArgs): Promise<ProviderResult> {
    const { model, apiKey, baseUrl, providerLabel, providerId, system, messages, maxOutputTokens, signal, handlers, webSearch, detailedCoT } = args;
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

    /*
     * Web search, for the providers offering it over this wire format. There
     * is no shared standard — each spells it its own way — so this branches on
     * the catalog id rather than pretending one shape fits all.
     *
     * OpenAI is deliberately absent: over /chat/completions it only searches
     * on its dedicated `-search-preview` models, which take no flag. There the
     * model id is the switch, which the catalog marks as "model-gated".
     */
    if (webSearch && providerId === "openrouter") {
      body.plugins = [{ id: "web" }];
    }

    /*
     * Reasoning, for the providers that can be told not to do it. Melon can
     * separate thinking from an answer when it arrives in a reasoning field,
     * but some models deliberate in the ordinary content stream instead,
     * where nothing distinguishes it from the reply. One Nemotron answer
     * spent its entire output budget narrating its own compliance checks and
     * was cut off before saying anything to the user.
     *
     * OpenRouter normalises each model's own switch behind this one
     * parameter, which covers families controlled by a system-prompt
     * directive as well as those with an API flag. Sent only when the user
     * has Detailed CoT off, and only to OpenRouter: `reasoning` is their
     * extension, not part of the shared wire format. This is the counterpart
     * of the `think: false` the Ollama adapter already sends.
     */
    if (providerId === "openrouter" && detailedCoT === false) {
      body.reasoning = { enabled: false };
    }

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
    const sources = new CitationCollector();

    /*
     * Reasoning models stream their thinking in a field beside the answer,
     * and the field is not standardised: DeepSeek calls it
     * `reasoning_content`, OpenRouter calls it `reasoning`. Reading only
     * `content` — as this did — discards it, and a model that spends its
     * whole token budget reasoning then returns an empty `content`, which
     * Melon rendered as a blank card. Exactly the fault found on Ollama, in
     * the adapter that speaks for a dozen more services.
     *
     * Wrapped in Melon's own CoT markers, so it reaches the same reasoning
     * drawer everything else uses.
     */
    let inThinking = false;
    const openThinking = async () => {
      if (inThinking) return;
      inThinking = true;
      const open = `${COT_START}\n`;
      text += open;
      await handlers.onToken(open);
    };
    const closeThinking = async () => {
      if (!inThinking) return;
      inThinking = false;
      const close = `\n${COT_END}\n`;
      text += close;
      await handlers.onToken(close);
    };

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
      const d = event.choices?.[0]?.delta;
      const thought = d?.reasoning_content ?? d?.reasoning;
      if (typeof thought === "string" && thought.length > 0) {
        await openThinking();
        text += thought;
        await handlers.onToken(thought);
      }

      const delta = d?.content;
      if (typeof delta === "string" && delta.length > 0) {
        // The answer beginning is what ends the reasoning section.
        await closeThinking();
        text += delta;
        await handlers.onToken(delta);
      }
      /*
       * url_citation annotations. OpenRouter and OpenAI's search models both
       * use this shape; it can arrive on the streaming delta or on a final
       * non-streamed message, so both are read.
       */
      const annotations =
        event.choices?.[0]?.delta?.annotations ?? event.choices?.[0]?.message?.annotations;
      if (Array.isArray(annotations)) {
        for (const a of annotations) {
          const cite = a?.url_citation ?? a;
          sources.add(cite?.url, cite?.title);
        }
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

    // Ran out of budget mid-thought, or the stream ended inside the reasoning
    // section: close it so the drawer is readable rather than left open.
    await closeThinking();

    return { text, usage: { inputTokens, outputTokens }, finishReason, citations: sources.list() };
  },
};

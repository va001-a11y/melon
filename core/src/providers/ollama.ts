import type { FinishReason, ProviderAdapter, ProviderChatArgs, ProviderResult } from "../types.js";
import { describeNetworkError, fetchLocalAware, readStreamLines, throwHttpError } from "./sse.js";
import { imageAttachments, inlineTextAttachments } from "./attachments.js";
import { estimateTokens } from "../guard.js";
import { COT_END, COT_START } from "../prompts.js";

const DEFAULT_BASE = "http://127.0.0.1:11434";

/**
 * How much context to ask a local model for.
 *
 * Ollama allocates the KV cache when the model loads, so num_ctx is not a
 * limit — it is a memory reservation made up front. A fixed 8192 was wrong in
 * both directions at once: wasteful for a short chat, and enough to stop a
 * 26B model loading at all on a machine that would have run it happily.
 *
 * So it is sized to the conversation actually being sent. Steps rather than
 * an exact number, because changing num_ctx forces Ollama to reload the
 * model: crossing a step costs one reload, while a value that crept up every
 * message would reload constantly.
 */
const CTX_STEPS = [2048, 4096, 8192, 16384, 32768, 65536, 131072];

/** Room for the reply and the chat template's own scaffolding. */
const CTX_HEADROOM = 512;

/** Used only when Ollama cannot say what the model supports. */
const CTX_FALLBACK = 8192;

function stepFor(tokens: number): number {
  return CTX_STEPS.find((n) => n >= tokens) ?? CTX_STEPS[CTX_STEPS.length - 1];
}

/** The next size down, for retrying after a model refused to load. */
function stepBelow(n: number): number {
  const smaller = CTX_STEPS.filter((s) => s < n);
  return smaller.length > 0 ? smaller[smaller.length - 1] : CTX_STEPS[0];
}

function rootOf(baseUrl: string | undefined): string {
  return (baseUrl || DEFAULT_BASE).replace(/\/+$/, "").replace(/\/(v1|api)$/i, "");
}

/**
 * The largest context this model was actually built for, straight from
 * Ollama rather than guessed.
 *
 * /api/show reports it under an architecture-prefixed key — "llama.
 * context_length", "gemma3.context_length" and so on — so the key is found by
 * suffix instead of hardcoding every architecture Ollama will ever support.
 *
 * Cached: it cannot change while a model file sits on disk, and the guard
 * asks for the same answer the adapter does.
 */
export interface OllamaModelInfo {
  /** Largest context the model was built for. */
  contextLength: number;
  /** Whether it has a thinking mode that can be switched off. */
  canThink: boolean;
}

const modelInfoCache = new Map<string, OllamaModelInfo>();

export async function ollamaModelInfo(
  baseUrl: string | undefined,
  model: string,
  signal?: AbortSignal
): Promise<OllamaModelInfo> {
  const root = rootOf(baseUrl);
  const cacheKey = `${root}::${model}`;
  const cached = modelInfoCache.get(cacheKey);
  if (cached) return cached;

  const fallback: OllamaModelInfo = { contextLength: CTX_FALLBACK, canThink: false };
  try {
    const res = await fetch(`${root}/api/show`, {
      method: "POST",
      // A local lookup that answers in milliseconds, so it gets a short
      // deadline of its own when the caller has no signal to offer. A wedged
      // daemon should not hold a conversation open indefinitely.
      signal: signal ?? AbortSignal.timeout(3000),
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model }),
    });
    if (!res.ok) return fallback;
    const data: any = await res.json();
    const info = data?.model_info ?? {};
    const key = Object.keys(info).find((k) => k.endsWith(".context_length"));
    const max = key ? Number(info[key]) : NaN;
    const resolved: OllamaModelInfo = {
      contextLength: Number.isFinite(max) && max >= 1024 ? max : CTX_FALLBACK,
      // Ollama lists what the model can do. Asked for on the same request
      // that fetches the context length, so knowing this is free — and it
      // means `think` is only ever sent to a model that has a thinking mode,
      // rather than hoping every other model ignores an unknown field.
      canThink: Array.isArray(data?.capabilities) && data.capabilities.includes("thinking"),
    };
    modelInfoCache.set(cacheKey, resolved);
    return resolved;
  } catch {
    // Ollama not running, or too old to report it. The caller still works.
    return fallback;
  }
}

/** Convenience for the context guard, which needs only the window. */
export async function ollamaMaxContext(
  baseUrl: string | undefined,
  model: string,
  signal?: AbortSignal
): Promise<number> {
  return (await ollamaModelInfo(baseUrl, model, signal)).contextLength;
}


/** Ollama speaks its own API at /api/chat and streams NDJSON, not SSE. */
export const ollama: ProviderAdapter = {
  id: "ollama",
  label: "Ollama",
  async chat(args: ProviderChatArgs): Promise<ProviderResult> {
    const { model, baseUrl, system, messages, maxOutputTokens, signal, handlers } = args;
    // Tolerate a pasted OpenAI-style URL: /v1 and /api are not part of the root.
    const base = rootOf(baseUrl);
    const requestUrl = `${base}/api/chat`;

    /*
     * Size the context to this conversation, capped at what the model can
     * actually take. Asking for the model's full window every time reserves
     * memory the chat does not need, which is what stops a large model
     * loading on a machine that could otherwise run it.
     */
    const promptChars =
      system.length + messages.reduce((n, m) => n + inlineTextAttachments(m).length, 0);
    const imageCount = messages.reduce((n, m) => n + imageAttachments(m).length, 0);
    const needed = estimateTokens(promptChars) + imageCount * 800 + maxOutputTokens + CTX_HEADROOM;

    const info = await ollamaModelInfo(baseUrl, model, signal);
    const modelMax = info.contextLength;
    if (needed > modelMax) {
      throw new Error(
        `This conversation needs about ${needed.toLocaleString()} tokens of context, but ${model} tops out at ` +
          `${modelMax.toLocaleString()}. Start a new chat, shorten it, or use a model with a larger window.`
      );
    }
    const requested = Math.min(stepFor(needed), modelMax);

    const post = async (numCtx: number) => {
      try {
        return await fetchLocalAware(requestUrl, {
          method: "POST",
          signal,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model,
            stream: true,
            // Ollama unloads a model after five idle minutes, and the next
            // request then pays a full reload before its first token.
            // Holding it for half an hour costs memory Melon is using anyway.
            keep_alive: "30m",
            /*
             * "Show reasoning" off means do not reason, where that can be
             * asked for. A reasoning model thinks regardless otherwise, and
             * the user waits through it with nothing on screen — measured at
             * 197 seconds on gemma4:26b, with the toggle off.
             *
             * Only sent to models that report a thinking capability, so a
             * plain model is never handed a field it has no opinion about.
             * Left alone when reasoning is switched on: that is the model
             * doing what the user asked for.
             */
            ...(info.canThink && args.detailedCoT === false ? { think: false } : {}),
            // num_ctx is not optional. Left unset, Ollama uses 4096 and
            // TRUNCATES anything longer without a word — no error, no
            // warning, just a model that stops seeing the start of the
            // conversation.
            options: { num_predict: maxOutputTokens, num_ctx: numCtx },
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
      } catch (err) {
        throw describeNetworkError(err, "Ollama", requestUrl);
      }
    };

    let attempt = await post(requested);

    /*
     * One step down and try again, when the machine could not find room.
     *
     * Ollama reserves the whole KV cache before it will answer, so "out of
     * memory" here is about the size asked for, not about the question. The
     * smaller window still holds this conversation — the step above it was
     * headroom — so retrying is better than handing the user a failure they
     * would fix by guessing at a number.
     */
    if (!attempt.res.ok && requested > CTX_STEPS[0]) {
      const detail = await attempt.res
        .clone()
        .text()
        .catch(() => "");
      if (/memory|resource|unable to (load|allocate)|too large/i.test(detail)) {
        attempt = await post(stepBelow(requested));
      }
    }

    const res = attempt.res;
    const url = attempt.url;
    if (!res.ok || !res.body) await throwHttpError(res, "Ollama", url);

    let text = "";
    let inputTokens = 0;
    let outputTokens = 0;
    let finishReason: FinishReason | undefined;

    /*
     * Reasoning models on Ollama answer in two channels: `thinking` and
     * `content`. Reading only `content` — which is what this did — threw the
     * reasoning away, and when the reply-length budget was spent thinking it
     * left `content` empty, so the card showed a blank reply for a model that
     * had worked perfectly. Measured on gemma4:26b: thirty tokens generated,
     * nothing displayed.
     *
     * The thinking is wrapped in Melon's own CoT markers instead, so it lands
     * in the reasoning drawer every other provider uses. Wrapped even when
     * Detailed CoT is off: the drawer is collapsed by default, and silently
     * discarding output the model produced is the bug, not the display.
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
      const thought = event.message?.thinking;
      if (typeof thought === "string" && thought.length > 0) {
        await openThinking();
        text += thought;
        await handlers.onToken(thought);
      }

      const chunk = event.message?.content;
      if (typeof chunk === "string" && chunk.length > 0) {
        // The answer starting is what ends the reasoning section.
        await closeThinking();
        text += chunk;
        await handlers.onToken(chunk);
      }

      if (event.done) {
        // Ran out of budget mid-thought: close the section anyway, so the
        // drawer is readable rather than left open forever. The empty answer
        // plus the "cut off early" note then says what happened.
        await closeThinking();
        inputTokens = event.prompt_eval_count ?? 0;
        outputTokens = event.eval_count ?? 0;
        // Ollama reports "length" when num_predict cut the reply short.
        finishReason = event.done_reason === "length" ? "length" : "stop";
      }
    }
    return { text, usage: { inputTokens, outputTokens }, finishReason };
  },
};

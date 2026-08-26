import type { ProviderAdapter, ProviderChatArgs, ProviderResult } from "../types.js";
import { COT_END, COT_START } from "../prompts.js";

/**
 * The built-in demo model: a fake provider that needs no key and no network.
 *
 * This used to be an OpenAI-compatible endpoint served by the Express app at
 * /api/demo/v1, which meant it could only exist where there was a server. It
 * generates its stream locally now, so it behaves identically whether Melon is
 * running from the desktop launcher or as a static page with no backend — and
 * there is one implementation rather than one per build.
 *
 * It goes through the same adapter contract as every real provider: same
 * streaming, same abort handling, same awaited `onToken` backpressure, so the
 * token-pace limit and Stop both work on it exactly as they do on a real model.
 */

/** Roughly a real model's visible pace, and slow enough to interrupt. */
const CHUNK_MS = 55;
const CHUNK_CHARS = 12;

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted || ms <= 0) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}

/**
 * What the demo says. It varies with what has already been said, because two
 * agents returning byte-identical text makes the relay look broken — the one
 * thing a demo most needs to show is agents building on each other.
 */
function compose(args: ProviderChatArgs): string {
  const { model, messages, system } = args;

  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const question = (lastUser?.content ?? "(no message)").trim().slice(0, 120);

  // Earlier agents in this run arrive as assistant turns in the history.
  const priorTurns = messages.filter((m) => m.role === "assistant");
  const isFollowUp = priorTurns.length > 0;

  // The orchestrator names the agent in its system prompt; pull it out so the
  // reply reads as coming from someone, without depending on the exact wording.
  const nameMatch = system.match(/You are ([^.,\n]{1,40})/);
  const me = nameMatch ? nameMatch[1].trim() : "the demo model";

  const reasoning =
    `Read the request: "${question}". ` +
    (isFollowUp
      ? `${priorTurns.length} agent${priorTurns.length === 1 ? " has" : "s have"} already spoken, so the useful move ` +
        `is to add something rather than repeat them. `
      : `Nothing has been said yet, so this turn should open with a direct answer. `) +
    `This is the built-in demo model, so no real inference happens — the point is to exercise streaming, ` +
    `Detailed CoT parsing, relay ordering and Stop.`;

  const answer = isFollowUp
    ? `Picking up where the last agent left off — I'm ${me}, running on the built-in demo model ` +
      `("${model}"), which needs no API key.\n\n` +
      `Notice that I can see what was said before me. That is the relay: agents take turns in sidebar ` +
      `order and each one reads the replies above it, which is why this reads as a discussion rather ` +
      `than two models talking past each other.\n\n` +
      `Add a real provider key and this same arrangement runs with actual models — the demo changes ` +
      `nothing about how Melon works, only who is answering.`
    : `Hello — I'm ${me}, running on the built-in demo model ("${model}"). No API key involved.\n\n` +
      `I'm streaming through exactly the same provider layer a real model uses, so everything you can ` +
      `do here works the same with Claude, GPT or a local Ollama model: expand the reasoning above, ` +
      `press Stop mid-sentence, or switch on more agents and watch them take turns.\n\n` +
      `Switch on a second agent and send this again — the next one will answer *me*, not just repeat the question.`;

  /*
   * Only show reasoning when the prompt actually asked for it. The system
   * prompt spells out the exact format when Detailed CoT is switched on, so
   * looking for the marker there is the same signal a real model acts on —
   * and it means the demo obeys the setting instead of ignoring it.
   *
   * Both markers are required: splitCot looks for COT_START first, and a
   * response carrying only the closing one renders the reasoning as if it
   * were the answer.
   */
  if (!system.includes(COT_START)) return answer;
  return `${COT_START}\n${reasoning}\n${COT_END}\n${answer}`;
}

export const demo: ProviderAdapter = {
  id: "demo",
  label: "Melon demo",

  async chat(args: ProviderChatArgs): Promise<ProviderResult> {
    const { messages, maxOutputTokens, signal, handlers } = args;

    const full = compose(args);
    // Honour the reply-length cap like a real provider, so the "stopped
    // because of the length limit" explanation is reachable in the demo too.
    const charCap = Math.max(1, maxOutputTokens) * 4;
    const capped = full.length > charCap;
    const text = capped ? full.slice(0, charCap) : full;

    let emitted = "";
    for (let i = 0; i < text.length; i += CHUNK_CHARS) {
      if (signal.aborted) break;
      const chunk = text.slice(i, i + CHUNK_CHARS);
      emitted += chunk;
      // Awaited, so the orchestrator's pace limiter can slow this down just
      // as it does a real stream.
      await handlers.onToken(chunk);
      await sleep(CHUNK_MS, signal);
    }

    return {
      text: emitted,
      usage: {
        // Not measured — estimated the same way the guard estimates elsewhere.
        inputTokens: Math.ceil(messages.reduce((n, m) => n + m.content.length, 0) / 4),
        outputTokens: Math.ceil(emitted.length / 4),
      },
      finishReason: signal.aborted ? "stop" : capped ? "length" : "stop",
    };
  },
};

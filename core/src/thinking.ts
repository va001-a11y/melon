/*
 * Switching a model's own thinking off.
 *
 * Some models reason privately before answering, whatever they are asked,
 * and the reasoning is billed as output. On a Reply length sized for an
 * answer, Nemotron spent all of it thinking and wrote nothing — then, asked
 * to continue, thought for 2,900 tokens more and wrote nothing again
 * (2026-11-05). Each provider that can turn it off spells the switch its own
 * way, and some models cannot turn it off at all, so the switch is offered
 * only where Melon knows one that works.
 *
 * Sources, checked 2026-11-15:
 *   NVIDIA   Nemotron 3.5 Lightning's NGC page: chat_template_kwargs
 *            {"enable_thinking": false}. Llama-based Nemotron: the system
 *            prompt "detailed thinking off". Some NVIDIA models (Muse Glimmer)
 *            cannot switch it off at all. Whether the hosted API accepts
 *            chat_template_kwargs is undocumented, so a refusal is retried
 *            without it (providers/openai.ts).
 *   Groq     reasoning_effort "none", for its Qwen models only; GPT-OSS
 *            cannot switch reasoning off.
 *   OpenRouter  reasoning {"enabled": false}, which it maps per model.
 *   Ollama   think: false, sent only to models reporting a thinking mode.
 *   Google   thinkingBudget 0, on Gemini 2.5 Flash and Flash-Lite; 2.5 Pro
 *            cannot switch it off.
 */

export type ThinkingSwitch =
  | { kind: "nvidia-kwargs" }
  | { kind: "nvidia-prompt" }
  | { kind: "groq-effort" }
  | { kind: "openrouter" }
  | { kind: "ollama" }
  | { kind: "gemini-budget" };

/** How this provider and model switch thinking off, or null when Melon knows no way. */
export function thinkingSwitch(providerId: string, model: string): ThinkingSwitch | null {
  const m = model.toLowerCase();
  switch (providerId) {
    case "nvidia":
      if (!m.includes("nemotron")) return null;
      return m.includes("llama") ? { kind: "nvidia-prompt" } : { kind: "nvidia-kwargs" };
    case "groq":
      return m.includes("qwen") ? { kind: "groq-effort" } : null;
    case "openrouter":
      return { kind: "openrouter" };
    case "ollama":
      return { kind: "ollama" };
    case "google":
      return /gemini-2\.5-flash/.test(m) ? { kind: "gemini-budget" } : null;
    default:
      return null;
  }
}

/** The line the older, Llama-based Nemotron models read as their switch. */
export const NEMOTRON_THINKING_OFF = "detailed thinking off";

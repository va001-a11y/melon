import type { Agent, Settings } from "./types";

/** USD per 1M tokens, keyed by substring match on the model id. */
interface Price {
  match: string;
  in: number;
  out: number;
}

const PRICES: Price[] = [
  { match: "claude-opus", in: 15, out: 75 },
  { match: "claude-sonnet", in: 3, out: 15 },
  { match: "claude-haiku", in: 1, out: 5 },
  { match: "gpt-5-mini", in: 0.25, out: 2 },
  { match: "gpt-5", in: 1.25, out: 10 },
  { match: "gpt-4o", in: 2.5, out: 10 },
  { match: "gemini-2.5-pro", in: 1.25, out: 10 },
  { match: "gemini-2.5-flash", in: 0.3, out: 2.5 },
  { match: "grok", in: 3, out: 15 },
  { match: "deepseek", in: 0.27, out: 1.1 },
  { match: "mistral-large", in: 2, out: 6 },
  { match: "llama", in: 0.6, out: 0.6 },
];

/** Local models and the built-in demo cost nothing. */
function isFree(agent: Agent): boolean {
  return agent.provider === "ollama" || agent.baseUrl.includes("/api/demo/");
}

function priceFor(agent: Agent): Price | null {
  if (isFree(agent)) return null;
  const id = agent.model.toLowerCase();
  return PRICES.find((p) => id.includes(p.match)) ?? null;
}

export interface Estimate {
  inputTokens: number;
  outputTokens: number;
  usd: number;
  /** True when at least one paid agent's model isn't in the price table. */
  hasUnpriced: boolean;
  freeCount: number;
}

export function estimateTokensFromChars(chars: number): number {
  return Math.ceil(chars / 4);
}

/**
 * Preflight estimate for one run: every active agent reprocesses the whole
 * conversation (input) and may emit up to maxOutputTokens (output).
 */
export function estimateRun(
  agents: Agent[],
  settings: Settings,
  historyChars: number,
  draftChars: number
): Estimate {
  const perAgentInput = estimateTokensFromChars(historyChars + draftChars) + 250; // + system prompt
  let inputTokens = 0;
  let outputTokens = 0;
  let usd = 0;
  let hasUnpriced = false;
  let freeCount = 0;

  for (const agent of agents) {
    // Reasoning output roughly doubles the answer; RAW CoT is more verbose still.
    const outFactor = settings.detailedCoT ? 0.85 : 0.6;
    const agentOut = Math.round(settings.maxOutputTokens * outFactor);
    inputTokens += perAgentInput;
    outputTokens += agentOut;

    if (isFree(agent)) {
      freeCount++;
      continue;
    }
    const price = priceFor(agent);
    if (!price) {
      hasUnpriced = true;
      continue;
    }
    usd += (perAgentInput / 1e6) * price.in + (agentOut / 1e6) * price.out;
  }

  return { inputTokens, outputTokens, usd, hasUnpriced, freeCount };
}

export function formatUsd(usd: number): string {
  if (usd === 0) return "$0.00";
  if (usd < 0.01) return "<$0.01";
  return `$${usd.toFixed(2)}`;
}

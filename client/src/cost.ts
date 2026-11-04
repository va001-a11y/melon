import type { Agent, Settings } from "./types";
import { PROVIDERS, webSearchBlockReason } from "@melon/core";

/*
 * The worst case of following links, so the preflight shows it before the
 * user sends rather than after. One choice per page, each re-reading the
 * search results and the pages opened so far, then the answer reading every
 * page: a search block, a page read in full, and the choice prompt itself.
 */
const SEARCH_BLOCK_TOKENS = 2500;
const OPENED_PAGE_TOKENS = 790;
const CHOICE_PROMPT_TOKENS = 300;
const CHOICE_REPLY_TOKENS = 150;

function followsLinks(agent: Agent, settings: Settings): boolean {
  const melonSearch = Boolean(settings.searchProvider && (settings.searchApiKeys?.[settings.searchProvider] ?? "").trim());
  const def = PROVIDERS.find((p) => p.id === agent.provider);
  return melonSearch && agent.webSearch === true && agent.followLinks === true && webSearchBlockReason(def, agent.model) !== null;
}

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
    let agentIn = perAgentInput;
    let agentOut = Math.round(settings.maxOutputTokens * outFactor);
    if (followsLinks(agent, settings)) {
      const pages = settings.linkLimit;
      for (let opened = 0; opened < pages; opened++) {
        agentIn += SEARCH_BLOCK_TOKENS + opened * OPENED_PAGE_TOKENS + CHOICE_PROMPT_TOKENS;
      }
      agentIn += pages * OPENED_PAGE_TOKENS;
      agentOut += pages * CHOICE_REPLY_TOKENS;
    }
    inputTokens += agentIn;
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
    usd += (agentIn / 1e6) * price.in + (agentOut / 1e6) * price.out;
  }

  return { inputTokens, outputTokens, usd, hasUnpriced, freeCount };
}

export function formatUsd(usd: number): string {
  if (usd === 0) return "$0.00";
  if (usd < 0.01) return "<$0.01";
  return `$${usd.toFixed(2)}`;
}

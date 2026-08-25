import type { Agent, Settings } from "./types";

export const ROLES = [
  { key: "generalist", label: "Generalist" },
  { key: "researcher", label: "Researcher" },
  { key: "writer", label: "Technical Writer" },
  { key: "simplifier", label: "Simplifier" },
  { key: "critic", label: "Critic" },
  { key: "synthesizer", label: "Synthesizer" },
];

export const MODES = [
  { key: "professional", label: "Professional" },
  { key: "sitcom", label: "Sitcom" },
  { key: "meme", label: "Meme / Creative" },
  { key: "research", label: "Research / Academic" },
  { key: "consensus", label: "Consensus / Fact-Check" },
];

/** Muted, warm agent colours that sit calmly on the paper background. */
export const AGENT_COLORS = [
  "#6f9e7d",
  "#c08a4a",
  "#7f9bb5",
  "#b07f9b",
  "#8d9a6b",
  "#a58aa8",
  "#c2926f",
  "#6f9a9c",
];

/** Reply length presets — friendlier than a raw token count. */
export const REPLY_LENGTHS = [
  { key: "short", label: "Short", tokens: 400, hint: "a paragraph or two" },
  { key: "medium", label: "Medium", tokens: 1024, hint: "a full answer" },
  { key: "long", label: "Long", tokens: 3000, hint: "detailed, with examples" },
  { key: "max", label: "Very long", tokens: 8192, hint: "essay length" },
];

export const DEFAULT_SETTINGS: Settings = {
  mode: "professional",
  detailedCoT: true,
  maxOutputTokens: 1024,
  sessionOutputBudget: 50000,
  globalPersonality: "",
  parallel: false,
  // One reply each, as it was before discussion modes existed.
  discussionMode: "single",
  rounds: 3,
  tokensPerMinute: 0,
  formatReplies: true,
};

/** Burn-rate slider bounds, in output tokens per minute. 0 = no limit. */
export const PACE_MAX = 12000;
export const PACE_STEP = 250;

export function describePace(tokensPerMinute: number): string {
  if (tokensPerMinute <= 0) return "No limit";
  const pace =
    tokensPerMinute <= 750
      ? "read along"
      : tokensPerMinute <= 2000
        ? "slow"
        : tokensPerMinute <= 5000
          ? "moderate"
          : "fast";
  return `${tokensPerMinute.toLocaleString()} tok/min — ${pace}`;
}

/** Runs costing more than this (USD) require an explicit confirmation. */
export const COST_CONFIRM_THRESHOLD = 0.5;

export function nextColor(existing: Agent[]): string {
  return AGENT_COLORS[existing.length % AGENT_COLORS.length];
}

export function makeId(): string {
  return Math.random().toString(36).slice(2, 10);
}

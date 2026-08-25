/*
 * Shared types come from @melon/core, which is the single definition both the
 * server and this app compile against. They used to be declared here as well
 * and had already drifted: this file's ProviderDef typed `protocol` and
 * `group` as plain strings and was missing `contextWindow` and `vision`
 * entirely, so the client could not see fields the server had been sending
 * for some time.
 *
 * Everything below the re-exports is genuinely client-only — chat history,
 * saved selections, view state — and has no business in the core.
 */
// Imported for use below, and re-exported so the rest of the app can keep
// importing them from "./types" without knowing where they really live.
import type { ProviderId, Usage, ProviderDef, Attachment as CoreAttachment } from "@melon/core";
export type { ProviderId, Usage, ProviderDef };

export interface Agent {
  id: string;
  name: string;
  provider: ProviderId;
  model: string;
  apiKey: string;
  baseUrl: string;
  role: string;
  personality: string;
  active: boolean;
  color: string;
  /** 1-based pipeline stage. Everything defaults to team 1. */
  team?: number;
}

export interface Settings {
  mode: string;
  detailedCoT: boolean;
  maxOutputTokens: number;
  /** Session-wide output token budget. 0 = unlimited. */
  sessionOutputBudget: number;
  /** Personality applied to every agent (inheritance: global → group → individual). */
  globalPersonality: string;
  /** All agents answer at once. Off by default: they take turns and build on each other. */
  parallel: boolean;
  /** How the conversation is structured. "single" restores one reply each. */
  discussionMode: "single" | "until-agreed" | "rounds";
  /** Passes, used only by "rounds". */
  rounds: number;
  /** Ceiling on output-token burn rate, tokens per minute. 0 = no limit. */
  tokensPerMinute: number;
  /** Render Markdown as formatted text instead of showing the raw source. */
  formatReplies: boolean;
  /** Set per-run when tone changed mid-chat; not persisted. */
  styleChangedFrom?: string;
  /** Pipeline team names and briefs, keyed by team number. */
  teamNames?: Record<string, string>;
  teamBriefs?: Record<string, string>;
}

/**
 * What the core sends to a provider, plus the byte size the composer shows on
 * the attachment chip. The size is display-only, which is why it lives here
 * rather than being pushed down into the core's own type.
 */
export interface Attachment extends CoreAttachment {
  /** Original size in bytes, for display. */
  size: number;
}

export interface CompatEndpoint {
  name: string;
  baseUrl: string;
  exampleModel: string;
}

/**
 * A saved line-up. As well as which agents are on, it records the pipeline
 * shape — which team each agent sits in, and what each team is called and
 * asked to do — so restoring a preset brings back the whole arrangement.
 */
export interface Preset {
  id: string;
  name: string;
  activeIds: string[];
  /** Agent id → team number. */
  teams?: Record<string, number>;
  teamNames?: Record<string, string>;
  teamBriefs?: Record<string, string>;
  /** Legacy field from earlier builds; ignored on load. */
  focusIds?: string[];
}

export interface ModelStats {
  key: string;
  provider: string;
  model: string;
  runs: number;
  completed: number;
  errors: number;
  stopped: number;
  throttled: number;
  inputTokens: number;
  outputTokens: number;
  totalMs: number;
  totalFirstTokenMs: number;
  firstTokenSamples: number;
  flagged: number;
}

export interface AnalyticsSnapshot {
  models: ModelStats[];
  runs: {
    totalRuns: number;
    burstRuns: number;
    continuousRounds: number;
    budgetAborts: number;
    agentInvocations: number;
  };
  uptimeMs: number;
}

export interface BundleAgent {
  name: string;
  provider: string;
  model: string;
  role: string;
  personality?: string;
  baseUrl?: string;
  /** Pipeline stage, 1-based. Absent means a single-team line-up. */
  team?: number;
}

export interface Bundle {
  id: string;
  name: string;
  description: string;
  tag: string;
  agents: BundleAgent[];
  /** Stage names and briefs, so a shared preset recreates the whole workflow. */
  teamNames?: Record<string, string>;
  teamBriefs?: Record<string, string>;
}

export interface ChatMeta {
  id: string;
  title: string;
  updatedAt: number;
  /** True once the user has renamed it, so auto-titling stops overwriting. */
  customTitle?: boolean;
}

export interface GuardState {
  session: Usage;
  budget: number;
  remainingFraction: number | null;
  dynamicLimit?: number;
}

// Usage is identical on both sides — re-exported so it can only ever have one
// definition. See the shared-type block at the top of this file.

export type ResponseStatus = "pending" | "streaming" | "done" | "error" | "stopped" | "throttled";

export interface AgentResponse {
  agentId: string;
  name: string;
  color: string;
  role: string;
  /** Raw accumulated stream text (may contain CoT markers). */
  text: string;
  status: ResponseStatus;
  error?: string;
  usage?: Usage;
  /** When this agent began, so the UI can show how long a wait has lasted. */
  startedAt?: number;
  /** Pipeline stage this reply came from, recorded so old chats still show it. */
  team?: number;
  teamName?: string;
  /** Why the reply ended — used to explain output that stops mid-sentence. */
  finishReason?: "stop" | "length" | "filtered" | "unknown";
  /** The reply-length cap in force at the time, for a precise explanation. */
  replyLimit?: number;
}

export interface RunMessage {
  id: string;
  kind: "run";
  agentOrder: string[];
  responses: Record<string, AgentResponse>;
  /** Which round of a multi-round discussion this block represents. */
  round?: number;
}

export type Message = UserMessage | RunMessage;

export interface RegistryEntry {
  provider: string;
  model: string;
  label: string;
  contextWindow: number;
  notes?: string;
}

export interface UserMessage {
  id: string;
  kind: "user";
  text: string;
  attachments?: Attachment[];
}

export interface RegistryInfo {
  providers: ProviderDef[];
  models: RegistryEntry[];
  endpoints: CompatEndpoint[];
  hardCap: number;
  recommended: { min: number; max: number };
}

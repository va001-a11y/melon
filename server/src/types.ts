export type Role = "system" | "user" | "assistant";

/** A file the user attached to a message. */
export interface Attachment {
  name: string;
  /** MIME type, e.g. image/png, text/plain, application/pdf. */
  mime: string;
  /** Base64 payload for images; plain text for text-like files. */
  kind: "image" | "text";
  data: string;
}

export interface ChatMessage {
  role: Role;
  content: string;
  attachments?: Attachment[];
}

/** Catalog provider id, e.g. "anthropic" | "perplexity" | "ollama" | "custom". */
export type ProviderId = string;

/** One participating model instance in a run. */
export interface AgentSpec {
  id: string;
  name: string;
  provider: ProviderId;
  model: string;
  apiKey?: string;
  /** Custom base URL for OpenAI-compatible or Ollama endpoints. */
  baseUrl?: string;
  /** Role template key, e.g. "researcher" | "writer" | "simplifier" | "critic" | "generalist". */
  role: string;
  /** Free-text personality/tone override for this agent. */
  personality?: string;
  /** Personality inherited from this agent's role group. */
  groupPersonality?: string;
  /**
   * Which team this agent belongs to, 1-based. Teams run in order and each
   * one receives everything the previous team produced, so a line-up can be
   * arranged as a pipeline: gather sources → draft → simplify.
   */
  team?: number;
}

export interface RunSettings {
  /** Conversation mode: professional | sitcom | meme | research | consensus */
  mode: string;
  detailedCoT: boolean;
  maxOutputTokens: number;
  /** Session-wide output token budget. 0 = unlimited. */
  sessionOutputBudget: number;
  /** Burst mode: user explicitly consented to bypass the dynamic limit for this run. */
  burst?: boolean;
  /** When true, all agents answer simultaneously. Default is a relay: one at a time. */
  parallel?: boolean;
  /**
   * How the conversation is structured:
   *  - "single"       one reply each, then back to the user (the default)
   *  - "until-agreed" they keep talking until they reach a shared conclusion
   *  - "rounds"       a fixed number of passes, for debates and similar
   */
  discussionMode?: "single" | "until-agreed" | "rounds";
  /** Number of passes, used only by "rounds". */
  rounds?: number;
  /**
   * Ceiling on how fast output tokens may be spent, in tokens per minute.
   * The run pauses between turns to stay under it. 0 = no limit.
   */
  tokensPerMinute?: number;
  /** Personality applied to every agent (inheritance: global → group → individual). */
  globalPersonality?: string;
  /**
   * Set when the user changed tone or personality partway through a chat.
   * Earlier replies still sit in the history and keep conditioning the
   * model's style, so the change must be stated outright to take effect.
   */
  styleChangedFrom?: string;
  /** What each team is for, keyed by team number, e.g. {"1": "Research"}. */
  teamNames?: Record<string, string>;
  /** What each team should do with the previous team's material. */
  teamBriefs?: Record<string, string>;
}

/** A prior turn in the shared conversation, as the client stores it. */
export interface HistoryTurn {
  role: "user" | "assistant";
  /** For assistant turns, which agent said it. */
  agentName?: string;
  content: string;
}

export interface RunRequest {
  userMessage: string;
  history: HistoryTurn[];
  agents: AgentSpec[];
  settings: RunSettings;
  attachments?: Attachment[];
  /** Client device profile for the dynamic limit algorithm. */
  device?: { cores?: number; memoryGb?: number };
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

export interface ProviderStreamHandlers {
  /**
   * May return a promise. Adapters await it, so the orchestrator can apply
   * backpressure — that is how the token-pace limit slows visible output.
   */
  onToken: (text: string) => void | Promise<void>;
}

/**
 * Why a reply ended. Providers each spell this differently, so adapters
 * normalise to these. "length" is the common one and the only one the user
 * can act on directly — it means the reply-length cap cut the model off.
 */
export type FinishReason = "stop" | "length" | "filtered" | "unknown";

export interface ProviderResult {
  text: string;
  usage: Usage;
  finishReason?: FinishReason;
}

export interface ProviderChatArgs {
  model: string;
  apiKey?: string;
  baseUrl?: string;
  /** Human-facing provider name, used in error messages. */
  providerLabel?: string;
  system: string;
  messages: ChatMessage[];
  maxOutputTokens: number;
  signal: AbortSignal;
  handlers: ProviderStreamHandlers;
}

export interface ProviderAdapter {
  id: ProviderId;
  label: string;
  chat(args: ProviderChatArgs): Promise<ProviderResult>;
}

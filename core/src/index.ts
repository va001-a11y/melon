/**
 * Melon's runtime-agnostic core.
 *
 * Everything here runs unchanged on a server or in a browser: orchestration,
 * prompt construction, the provider adapters, the token guard and the catalog.
 * Nothing in this package may import `node:*`, touch `process`, or assume a
 * DOM — `core/tsconfig.json` omits `@types/node` so any such slip fails to
 * compile here rather than at runtime in front of a user.
 *
 * What deliberately stays outside: HTTP routing, PDF extraction (`pdf-parse`
 * is Node-only) and anything that owns a socket.
 */

export type { RunSink } from "./orchestrator.js";
export { attachmentTokens, runConversation } from "./orchestrator.js";

export * from "./types.js";

export {
  PROVIDERS,
  contextWindowFor,
  browserBlockReason,
  webSearchBlockReason,
  webSearchIsAutomatic,
} from "./catalog.js";
export type { ProviderDef, BrowserSupport, WebSearchSupport } from "./catalog.js";

export {
  COMPAT_PROVIDERS,
  HARD_AGENT_CAP,
  MODEL_REGISTRY,
  RECOMMENDED_AGENTS,
} from "./registry.js";

export {
  SEARCH_PROVIDERS,
  formatSearchContext,
  getSearchProvider,
  runWebSearch,
  trimQuery,
} from "./search.js";
export type { SearchHit, SearchProviderDef, SearchProviderId } from "./search.js";

export { computeDynamicLimit, estimateTokens, tokenGuard } from "./guard.js";
export { analytics } from "./analytics.js";
export { stopController } from "./stop.js";
export { BUNDLES } from "./marketplace.js";
export { listModelsFor, testAgentConnection } from "./models.js";
export type { ModelListResult } from "./models.js";
export { resolveTarget } from "./providers/index.js";

export {
  buildMessages,
  buildSystemPrompt,
  COT_END,
  hasConcluded,
  stripConclusion,
  stripSpeakerLabel,
} from "./prompts.js";
export type { PriorTurn } from "./prompts.js";

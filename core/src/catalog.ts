/**
 * Provider catalog — the single source of truth for what Melon can talk to.
 *
 * Each entry names a real service and declares which wire protocol it speaks.
 * Four protocols cover the whole industry: Anthropic's Messages API, Google's
 * generateContent, Ollama's local API, and the OpenAI /chat/completions shape
 * that nearly everyone else implements. Adding a service is a data change.
 */
export type Protocol = "openai" | "anthropic" | "google" | "ollama" | "demo";

/**
 * How a provider behaves when called straight from a web page.
 *
 * "ok"          — verified working from a browser origin.
 * "needs-header"— works, but only with an extra opt-in request header.
 * "cors-blocked"— verified to refuse browser requests. Nothing on our side
 *                 can change this; the block is the provider's.
 * "local-only"  — a service on the user's own machine, which a page served
 *                 over HTTPS cannot reach.
 * "unverified"  — the endpoint is supplied by the user, so whether it allows
 *                 browser calls depends on how they configured it.
 */
export type BrowserSupport = "ok" | "needs-header" | "cors-blocked" | "local-only" | "unverified";

/**
 * Whether a provider can look things up on the web, and how.
 *
 * Melon uses each provider's own search rather than calling a search API
 * itself. That keeps it bring-your-own-*one*-key, works in the hosted build
 * where there is no server to proxy through, and avoids a second set of CORS
 * problems — the provider does the searching on its own machines.
 *
 * "native"      — send a flag with the request and the provider searches.
 * "always"      — grounded in search by design; there is nothing to switch on.
 * "model-gated" — supported, but only by particular models, so the user has to
 *                 choose one rather than tick a box.
 * absent        — no web search. Most open-weight hosts are here.
 */
export type WebSearchSupport = "native" | "always" | "model-gated";

export interface ProviderDef {
  id: string;
  label: string;
  protocol: Protocol;
  /** Fixed endpoint for hosted services; undefined means the user must supply one. */
  baseUrl?: string;
  needsKey: boolean;
  /** Local runtimes and custom endpoints let the user change the URL. */
  editableBaseUrl: boolean;
  /** Where to get a key. */
  keyUrl?: string;
  exampleModels: string[];
  /** Grouping for the picker. */
  group: "Frontier" | "Open & fast" | "Aggregator" | "Local" | "Search" | "Custom";
  note?: string;
  /**
   * Whether this provider can be reached directly from a web page.
   *
   * The hosted build has no server to proxy through, so a provider that
   * refuses cross-origin browser requests simply cannot be used there. These
   * values come from testing each endpoint from a real browser origin, not
   * from reading documentation — several providers document CORS support they
   * do not actually send headers for.
   *
   * Providers marked unreachable are still listed in the picker, disabled and
   * carrying the reason: quietly dropping them would make the hosted build
   * look like it supports fewer models than it does.
   */
  browser?: BrowserSupport;
  /** Whether this provider can search the web, and how it is switched on. */
  webSearch?: WebSearchSupport;
  /**
   * Models that support search when `webSearch` is "model-gated" — matched as
   * substrings of the model id, since providers version them.
   */
  webSearchModels?: string[];
  /** Conservative context window in tokens. Omitted entries use a safe default. */
  contextWindow?: number;
  /** Whether this provider accepts image attachments. */
  vision?: boolean;
}

/*
 * Fallback when a provider doesn't declare a window.
 *
 * Ten providers have no contextWindow of their own, and 32,000 wrongly
 * blocked conversations that their models handle comfortably — most current
 * chat models are 128k or larger. The two failure directions are not
 * symmetric: guessing low blocks a legitimate request with no way for the
 * user to proceed, while guessing high lets the provider reject it, and that
 * path already reports the real size and what to do about it. So this errs
 * high deliberately.
 */
const DEFAULT_CONTEXT_WINDOW = 128000;

export function contextWindowFor(providerId: string): number {
  return getProvider(providerId)?.contextWindow ?? DEFAULT_CONTEXT_WINDOW;
}

export function supportsVision(providerId: string): boolean {
  return getProvider(providerId)?.vision ?? false;
}

export const PROVIDERS: ProviderDef[] = [
  // ---- Frontier labs (native protocols) ----
  {
    id: "anthropic",
    label: "Anthropic (Claude)",
    protocol: "anthropic",
    baseUrl: "https://api.anthropic.com",
    needsKey: true,
    editableBaseUrl: false,
    keyUrl: "https://console.anthropic.com/settings/keys",
    webSearch: "native",
    browser: "needs-header",
    group: "Frontier",
    exampleModels: ["claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5-20251001"],
    contextWindow: 200000,
    vision: true,
  },
  {
    id: "openai",
    label: "OpenAI (GPT)",
    protocol: "openai",
    baseUrl: "https://api.openai.com/v1",
    needsKey: true,
    editableBaseUrl: false,
    keyUrl: "https://platform.openai.com/api-keys",
    webSearch: "model-gated",
    webSearchModels: ["search-preview"],
    browser: "ok",
    group: "Frontier",
    exampleModels: ["gpt-5", "gpt-5-mini", "gpt-4o"],
    contextWindow: 272000,
    vision: true,
  },
  {
    id: "google",
    label: "Google (Gemini)",
    protocol: "google",
    baseUrl: "https://generativelanguage.googleapis.com",
    needsKey: true,
    editableBaseUrl: false,
    keyUrl: "https://aistudio.google.com/apikey",
    webSearch: "native",
    browser: "ok",
    group: "Frontier",
    exampleModels: ["gemini-2.5-pro", "gemini-2.5-flash"],
    contextWindow: 1000000,
    vision: true,
  },
  {
    id: "xai",
    label: "xAI (Grok)",
    protocol: "openai",
    baseUrl: "https://api.x.ai/v1",
    needsKey: true,
    editableBaseUrl: false,
    keyUrl: "https://console.x.ai",
    browser: "ok",
    group: "Frontier",
    exampleModels: ["grok-4", "grok-3-mini"],
    contextWindow: 256000,
    vision: true,
  },
  {
    id: "mistral",
    label: "Mistral",
    protocol: "openai",
    baseUrl: "https://api.mistral.ai/v1",
    needsKey: true,
    editableBaseUrl: false,
    keyUrl: "https://console.mistral.ai/api-keys",
    browser: "ok",
    group: "Frontier",
    exampleModels: ["mistral-large-latest", "mistral-small-latest", "magistral-medium-latest"],
    contextWindow: 128000,
    vision: true,
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    protocol: "openai",
    baseUrl: "https://api.deepseek.com/v1",
    needsKey: true,
    editableBaseUrl: false,
    keyUrl: "https://platform.deepseek.com/api_keys",
    browser: "ok",
    group: "Frontier",
    exampleModels: ["deepseek-chat", "deepseek-reasoner"],
    contextWindow: 128000,
  },
  {
    id: "cohere",
    label: "Cohere (Command)",
    protocol: "openai",
    baseUrl: "https://api.cohere.ai/compatibility/v1",
    needsKey: true,
    editableBaseUrl: false,
    keyUrl: "https://dashboard.cohere.com/api-keys",
    browser: "ok",
    group: "Frontier",
    exampleModels: ["command-a-03-2025", "command-r-plus"],
  },

  // ---- Search-grounded ----
  {
    id: "perplexity",
    label: "Perplexity (Sonar)",
    protocol: "openai",
    baseUrl: "https://api.perplexity.ai",
    needsKey: true,
    editableBaseUrl: false,
    keyUrl: "https://www.perplexity.ai/settings/api",
    webSearch: "always",
    browser: "ok",
    group: "Search",
    exampleModels: ["sonar-pro", "sonar", "sonar-reasoning-pro"],
    contextWindow: 128000,
    note: "Answers are grounded in live web search — good as a Researcher.",
  },

  // ---- Open models / fast inference ----
  {
    id: "nvidia",
    label: "NVIDIA NIM (Nemotron)",
    protocol: "openai",
    baseUrl: "https://integrate.api.nvidia.com/v1",
    needsKey: true,
    editableBaseUrl: false,
    keyUrl: "https://build.nvidia.com",
    browser: "cors-blocked",
    group: "Open & fast",
    exampleModels: [
      "nvidia/llama-3.3-nemotron-super-49b-v1.5",
      "nvidia/llama-3.1-nemotron-70b-instruct",
      "meta/llama-3.3-70b-instruct",
    ],
    note: "Nemotron and many open models, hosted by NVIDIA.",
  },
  {
    id: "moonshot",
    label: "Moonshot (Kimi)",
    protocol: "openai",
    baseUrl: "https://api.moonshot.ai/v1",
    needsKey: true,
    editableBaseUrl: false,
    keyUrl: "https://platform.moonshot.ai/console/api-keys",
    browser: "ok",
    group: "Open & fast",
    exampleModels: ["kimi-k2-0711-preview", "moonshot-v1-128k"],
  },
  {
    id: "groq",
    label: "Groq (very fast)",
    protocol: "openai",
    baseUrl: "https://api.groq.com/openai/v1",
    needsKey: true,
    editableBaseUrl: false,
    keyUrl: "https://console.groq.com/keys",
    browser: "ok",
    group: "Open & fast",
    exampleModels: ["llama-3.3-70b-versatile", "qwen-2.5-32b"],
    contextWindow: 128000,
  },
  {
    id: "cerebras",
    label: "Cerebras (very fast)",
    protocol: "openai",
    baseUrl: "https://api.cerebras.ai/v1",
    needsKey: true,
    editableBaseUrl: false,
    keyUrl: "https://cloud.cerebras.ai",
    browser: "cors-blocked",
    group: "Open & fast",
    exampleModels: ["llama-3.3-70b", "qwen-3-32b"],
  },
  {
    id: "together",
    label: "Together AI",
    protocol: "openai",
    baseUrl: "https://api.together.xyz/v1",
    needsKey: true,
    editableBaseUrl: false,
    keyUrl: "https://api.together.ai/settings/api-keys",
    browser: "ok",
    group: "Open & fast",
    exampleModels: ["meta-llama/Llama-3.3-70B-Instruct-Turbo", "deepseek-ai/DeepSeek-V3"],
  },
  {
    id: "fireworks",
    label: "Fireworks AI",
    protocol: "openai",
    baseUrl: "https://api.fireworks.ai/inference/v1",
    needsKey: true,
    editableBaseUrl: false,
    keyUrl: "https://fireworks.ai/account/api-keys",
    browser: "ok",
    group: "Open & fast",
    exampleModels: ["accounts/fireworks/models/llama-v3p3-70b-instruct"],
  },
  {
    id: "deepinfra",
    label: "DeepInfra",
    protocol: "openai",
    baseUrl: "https://api.deepinfra.com/v1/openai",
    needsKey: true,
    editableBaseUrl: false,
    keyUrl: "https://deepinfra.com/dash/api_keys",
    browser: "ok",
    group: "Open & fast",
    exampleModels: ["meta-llama/Llama-3.3-70B-Instruct", "Qwen/Qwen2.5-72B-Instruct"],
  },

  // ---- Aggregators ----
  {
    id: "openrouter",
    label: "OpenRouter (300+ models)",
    protocol: "openai",
    baseUrl: "https://openrouter.ai/api/v1",
    needsKey: true,
    editableBaseUrl: false,
    keyUrl: "https://openrouter.ai/keys",
    webSearch: "native",
    browser: "ok",
    group: "Aggregator",
    exampleModels: ["anthropic/claude-sonnet-5", "google/gemini-2.5-pro", "meta-llama/llama-3.3-70b-instruct"],
    contextWindow: 128000,
    vision: true,
    note: "One key reaches hundreds of models from most major labs.",
  },
  {
    id: "github-models",
    label: "GitHub Models (Copilot-adjacent)",
    protocol: "openai",
    baseUrl: "https://models.github.ai/inference",
    needsKey: true,
    editableBaseUrl: false,
    keyUrl: "https://github.com/settings/tokens",
    browser: "cors-blocked",
    group: "Aggregator",
    exampleModels: ["openai/gpt-4o", "microsoft/phi-4", "mistral-ai/mistral-large-2411"],
    note: "Use a GitHub PAT with the models scope. GitHub Copilot itself has no public chat API for third-party apps — this is Microsoft's supported way in.",
  },
  {
    id: "azure",
    label: "Azure AI / OpenAI",
    protocol: "openai",
    needsKey: true,
    editableBaseUrl: true,
    browser: "unverified",
    group: "Aggregator",
    exampleModels: ["gpt-4o", "Llama-3.3-70B-Instruct"],
    note: "Paste your resource endpoint, e.g. https://<resource>.openai.azure.com/openai/v1",
  },

  // ---- Local ----
  {
    id: "ollama",
    label: "Ollama (local)",
    protocol: "ollama",
    baseUrl: "http://127.0.0.1:11434",
    needsKey: false,
    editableBaseUrl: true,
    browser: "local-only",
    group: "Local",
    exampleModels: ["llama3.2", "qwen2.5", "mistral", "phi4"],
    note: "Runs on your machine, free. Install from ollama.com, then `ollama pull llama3.2`. Melon tries both 127.0.0.1 and localhost automatically.",
  },
  {
    id: "lmstudio",
    label: "LM Studio (local)",
    protocol: "openai",
    baseUrl: "http://127.0.0.1:1234/v1",
    needsKey: false,
    editableBaseUrl: true,
    browser: "local-only",
    group: "Local",
    exampleModels: ["local-model"],
    note: "Start the local server from LM Studio's Developer tab.",
  },
  {
    id: "llamacpp",
    label: "llama.cpp / vLLM (local)",
    protocol: "openai",
    baseUrl: "http://127.0.0.1:8080/v1",
    needsKey: false,
    editableBaseUrl: true,
    browser: "local-only",
    group: "Local",
    exampleModels: ["local-model"],
  },
  {
    id: "demo",
    label: "Melon demo (no key)",
    // Generated in-process by providers/demo.ts. No endpoint and no network,
    // so it behaves identically in the desktop build and a static browser one.
    protocol: "demo",
    needsKey: false,
    editableBaseUrl: false,
    browser: "ok",
    group: "Local",
    exampleModels: ["melon-demo"],
    note: "Built-in fake model. No key, no network — try Melon before adding a provider.",
  },

  // ---- Escape hatch ----
  {
    id: "custom",
    label: "Custom OpenAI-compatible…",
    protocol: "openai",
    needsKey: true,
    editableBaseUrl: true,
    browser: "unverified",
    group: "Custom",
    exampleModels: [],
    note: "Any service exposing POST /chat/completions. Most APIs on directories like AIxploria do.",
  },
];

export function getProvider(id: string): ProviderDef | undefined {
  return PROVIDERS.find((p) => p.id === id);
}

/**
 * Why a provider cannot be used from a web page, phrased for the person
 * choosing it — or null when it works fine there.
 *
 * Lives here rather than in the UI so the explanation stays next to the fact
 * it explains: if a provider's `browser` value changes, the wording it
 * produces changes with it.
 */
export function browserBlockReason(def: ProviderDef): string | null {
  switch (def.browser) {
    case "cors-blocked":
      return "blocked by the provider in browsers";
    case "local-only":
      return "runs on your own machine";
    default:
      return null;
  }
}

/**
 * Whether an agent on this provider/model can actually search, and if not,
 * why — phrased for the person configuring it.
 *
 * Returns `null` when search is available and switchable. "always" providers
 * also return null but need no toggle; callers use `webSearchIsAutomatic`.
 */
export function webSearchBlockReason(def: ProviderDef | undefined, model: string): string | null {
  if (!def) return "pick a provider first";
  switch (def.webSearch) {
    case "native":
    case "always":
      return null;
    case "model-gated": {
      const ok = (def.webSearchModels ?? []).some((m) => model.toLowerCase().includes(m));
      return ok ? null : `only ${def.label}'s search models can (try one ending "-search-preview")`;
    }
    default:
      return `${def.label} has no web search`;
  }
}

/** True when the provider always searches and there is nothing to switch on. */
export function webSearchIsAutomatic(def: ProviderDef | undefined): boolean {
  return def?.webSearch === "always";
}

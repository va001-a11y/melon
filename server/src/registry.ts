/**
 * Model capability registry (Phase 1: curated static catalog).
 * The client uses this to populate the add-agent form; users can always
 * type any model id manually — BYOK means we never gate on this list.
 */
export interface RegistryEntry {
  provider: string;
  model: string;
  label: string;
  contextWindow: number;
  streaming: boolean;
  notes?: string;
}

export const MODEL_REGISTRY: RegistryEntry[] = [
  { provider: "anthropic", model: "claude-sonnet-5", label: "Claude Sonnet 5", contextWindow: 200000, streaming: true },
  { provider: "anthropic", model: "claude-opus-5", label: "Claude Opus 5", contextWindow: 200000, streaming: true },
  { provider: "anthropic", model: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5", contextWindow: 200000, streaming: true, notes: "Fast/cheap — good for simplifier roles" },
  { provider: "openai", model: "gpt-5", label: "GPT-5", contextWindow: 400000, streaming: true },
  { provider: "openai", model: "gpt-5-mini", label: "GPT-5 mini", contextWindow: 400000, streaming: true },
  { provider: "openai", model: "gpt-4o", label: "GPT-4o", contextWindow: 128000, streaming: true },
  { provider: "google", model: "gemini-2.5-pro", label: "Gemini 2.5 Pro", contextWindow: 1000000, streaming: true },
  { provider: "google", model: "gemini-2.5-flash", label: "Gemini 2.5 Flash", contextWindow: 1000000, streaming: true },
  { provider: "ollama", model: "llama3.2", label: "Llama 3.2 (local)", contextWindow: 128000, streaming: true, notes: "Requires local Ollama" },
  { provider: "ollama", model: "qwen2.5", label: "Qwen 2.5 (local)", contextWindow: 128000, streaming: true, notes: "Requires local Ollama" },
];

/**
 * Endpoint directory: known OpenAI-compatible providers. This is how the
 * platform reaches the wider AI universe (AIxploria-style lists) — anything
 * exposing the de-facto-standard /chat/completions API plugs straight in,
 * and aggregators like OpenRouter proxy hundreds of models by themselves.
 */
export interface CompatProvider {
  name: string;
  baseUrl: string;
  exampleModel: string;
}

export const COMPAT_PROVIDERS: CompatProvider[] = [
  { name: "OpenAI (default)", baseUrl: "https://api.openai.com/v1", exampleModel: "gpt-5" },
  { name: "OpenRouter (300+ models)", baseUrl: "https://openrouter.ai/api/v1", exampleModel: "anthropic/claude-sonnet-5" },
  { name: "xAI (Grok)", baseUrl: "https://api.x.ai/v1", exampleModel: "grok-4" },
  { name: "Mistral", baseUrl: "https://api.mistral.ai/v1", exampleModel: "mistral-large-latest" },
  { name: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", exampleModel: "deepseek-chat" },
  { name: "Groq (fast Llama)", baseUrl: "https://api.groq.com/openai/v1", exampleModel: "llama-3.3-70b-versatile" },
  { name: "Together (open models)", baseUrl: "https://api.together.xyz/v1", exampleModel: "meta-llama/Llama-3.3-70B-Instruct-Turbo" },
  { name: "Fireworks", baseUrl: "https://api.fireworks.ai/inference/v1", exampleModel: "accounts/fireworks/models/llama-v3p3-70b-instruct" },
  { name: "Perplexity", baseUrl: "https://api.perplexity.ai", exampleModel: "sonar-pro" },
  { name: "Cerebras", baseUrl: "https://api.cerebras.ai/v1", exampleModel: "llama-3.3-70b" },
  { name: "Moonshot (Kimi)", baseUrl: "https://api.moonshot.ai/v1", exampleModel: "kimi-k2-0711-preview" },
  { name: "vedAI demo (no key)", baseUrl: "http://localhost:5175/api/demo/v1", exampleModel: "demo" },
];

export const HARD_AGENT_CAP = 100;
export const RECOMMENDED_AGENTS = { min: 3, max: 6 };

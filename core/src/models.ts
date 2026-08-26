import type { AgentSpec } from "./types.js";
import { resolveTarget } from "./providers/index.js";

export interface ModelListResult {
  ok: boolean;
  models?: string[];
  total?: number;
  label?: string;
  message?: string;
}

/**
 * Ask a provider which models it actually serves right now.
 *
 * Hardcoded model ids go stale — providers retire models on their own
 * schedule — so reading the live list means a decommissioned id is visibly
 * gone rather than failing mid-run.
 *
 * This was an Express handler. Nothing about it needed a server: it is one
 * fetch and some shape-normalising, so it lives in the core and both builds
 * call it — the desktop one through an HTTP route, the hosted one directly.
 */
export async function listModelsFor(agent: AgentSpec, timeoutMs = 15000): Promise<ModelListResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const target = resolveTarget(agent);
    if (target.needsKey && !agent.apiKey?.trim()) {
      return { ok: false, message: `${target.label} needs an API key before it will list its models.` };
    }

    // The demo model is generated in-process, so there is nothing to ask.
    if (target.protocol === "demo") {
      return { ok: true, models: ["melon-demo"], total: 1, label: target.label };
    }

    const base = (target.baseUrl ?? "").replace(/\/+$/, "");
    let url = "";
    const headers: Record<string, string> = {};

    switch (target.protocol) {
      case "anthropic":
        url = `${base.replace(/\/v1$/, "")}/v1/models?limit=100`;
        headers["x-api-key"] = agent.apiKey ?? "";
        headers["anthropic-version"] = "2023-06-01";
        // Same browser opt-in the chat call needs; see providers/anthropic.ts.
        if (typeof window !== "undefined") headers["anthropic-dangerous-direct-browser-access"] = "true";
        break;
      case "google":
        url = `${base}/v1beta/models`;
        headers["x-goog-api-key"] = agent.apiKey ?? "";
        break;
      case "ollama":
        url = `${base.replace(/\/(v1|api)$/i, "")}/api/tags`;
        break;
      default:
        url = `${base}/models`;
        if (agent.apiKey) headers.authorization = `Bearer ${agent.apiKey}`;
    }

    const response = await fetch(url, { headers, signal: controller.signal });
    if (!response.ok) {
      const detail = (await response.text().catch(() => "")).slice(0, 200);
      return {
        ok: false,
        message:
          response.status === 401 || response.status === 403
            ? `${target.label} rejected the API key.`
            : `${target.label} would not list models (${response.status}). ${detail}`,
      };
    }

    const data: any = await response.json();
    let models: string[] = [];
    if (Array.isArray(data?.data)) {
      // OpenAI-compatible and Anthropic both return {data: [{id}]}.
      models = data.data.map((m: any) => m.id ?? m.name).filter(Boolean);
    } else if (Array.isArray(data?.models)) {
      // Google returns models/<id>; Ollama returns {name}.
      models = data.models.map((m: any) => String(m.name ?? m.model ?? "").replace(/^models\//, "")).filter(Boolean);
    }

    // Chat models first: filter out obvious non-chat endpoints.
    const noise = /embed|whisper|tts|moderation|image|dall-e|rerank|guard|vision-encoder/i;
    const chat = models.filter((m) => !noise.test(m));

    return {
      ok: true,
      models: (chat.length > 0 ? chat : models).sort((a, b) => a.localeCompare(b)),
      total: models.length,
      label: target.label,
    };
  } catch (err) {
    return {
      ok: false,
      message: controller.signal.aborted
        ? "Timed out asking the provider for its model list."
        : err instanceof Error
          ? err.message
          : String(err),
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Send one tiny message to check a provider, model and key really work. */
export async function testAgentConnection(
  agent: AgentSpec,
  timeoutMs = 20000
): Promise<{ ok: boolean; message: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const target = resolveTarget(agent);
    if (target.needsKey && !agent.apiKey?.trim()) {
      return { ok: false, message: `${target.label} needs an API key.` };
    }
    let got = "";
    await target.adapter.chat({
      model: agent.model,
      apiKey: agent.apiKey,
      baseUrl: target.baseUrl,
      providerLabel: target.label,
      system: "Reply with the single word: ok",
      messages: [{ role: "user", content: "Say ok." }],
      maxOutputTokens: 16,
      signal: controller.signal,
      handlers: {
        onToken: (t) => {
          got += t;
        },
      },
    });
    return { ok: true, message: `${target.label} responded${got.trim() ? `: “${got.trim().slice(0, 60)}”` : "."}` };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, message: controller.signal.aborted ? "Timed out." : message };
  } finally {
    clearTimeout(timer);
  }
}

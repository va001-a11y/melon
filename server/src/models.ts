import type { Request, Response } from "express";
import type { AgentSpec } from "./types.js";
import { resolveTarget } from "./providers/index.js";

/**
 * Ask the provider which models it actually serves right now.
 *
 * Hardcoded model ids go stale — providers retire models on their own
 * schedule. Reading the live list means a decommissioned id is visibly gone
 * rather than failing at run time.
 */
export async function listModels(req: Request, res: Response): Promise<void> {
  const agent = req.body as AgentSpec;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);

  try {
    const target = resolveTarget(agent);
    if (target.needsKey && !agent.apiKey?.trim()) {
      res.json({ ok: false, message: `${target.label} needs an API key before it will list its models.` });
      return;
    }

    const base = (target.baseUrl ?? "").replace(/\/+$/, "");
    let url = "";
    const headers: Record<string, string> = {};

    switch (target.protocol) {
      case "anthropic":
        url = `${base.replace(/\/v1$/, "")}/v1/models?limit=100`;
        headers["x-api-key"] = agent.apiKey ?? "";
        headers["anthropic-version"] = "2023-06-01";
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
      res.json({
        ok: false,
        message:
          response.status === 401 || response.status === 403
            ? `${target.label} rejected the API key.`
            : `${target.label} would not list models (${response.status}). ${detail}`,
      });
      return;
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

    res.json({
      ok: true,
      models: (chat.length > 0 ? chat : models).sort((a, b) => a.localeCompare(b)),
      total: models.length,
      label: target.label,
    });
  } catch (err) {
    res.json({
      ok: false,
      message: controller.signal.aborted
        ? "Timed out asking the provider for its model list."
        : err instanceof Error
          ? err.message
          : String(err),
    });
  } finally {
    clearTimeout(timer);
  }
}

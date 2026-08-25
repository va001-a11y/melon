import type { Agent, AnalyticsSnapshot, Attachment, Bundle, GuardState, RegistryInfo, Settings, Usage } from "./types";

export interface HistoryTurn {
  role: "user" | "assistant";
  agentName?: string;
  content: string;
}

export interface RunCallbacks {
  onRoundStart: (round: number) => void;
  onAgentStart: (agentId: string, round?: number) => void;
  onToken: (agentId: string, text: string, round?: number) => void;
  onAgentDone: (agentId: string, usage: Usage, round?: number, meta?: { finishReason?: string; replyLimit?: number }) => void;
  onAgentError: (agentId: string, message: string, round?: number) => void;
  onAgentStopped: (agentId: string, round?: number) => void;
  onAgentThrottled: (agentId: string, round?: number) => void;
  onThrottle: (limit: number, reasons: string[]) => void;
  onBudgetStop: (budget: number, used: number) => void;
  onContextFull: (used: number, limit: number) => void;
  onRate: (rate: number, spent: number, limit: number) => void;
  onPacing: (waitMs: number) => void;
  onConcluded: () => void;
  onGuard: (guard: GuardState) => void;
  onRunEnd: (stopped: boolean) => void;
  onError: (message: string) => void;
}

export async function getAnalytics(): Promise<AnalyticsSnapshot> {
  const res = await fetch("/api/analytics");
  return res.json();
}

export async function resetAnalytics(): Promise<void> {
  await fetch("/api/analytics/reset", { method: "POST" });
}

export async function flagResponse(provider: string, model: string): Promise<void> {
  await fetch("/api/analytics/flag", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ provider, model }),
  });
}

export async function getMarketplace(): Promise<{ bundles: Bundle[] }> {
  return fetchJson<{ bundles: Bundle[] }>("/api/marketplace");
}

export interface LocalRuntime {
  id: string;
  label: string;
  found: boolean;
  baseUrl: string;
  models: string[];
}

export interface DetectResult {
  runtimes: LocalRuntime[];
  /** Plain-English explanation when Ollama is missing. */
  diagnosis: string | null;
}

export async function detectLocal(): Promise<DetectResult> {
  try {
    const res = await fetch("/api/detect-local");
    const data = await res.json();
    return { runtimes: data.runtimes ?? [], diagnosis: data.diagnosis ?? null };
  } catch {
    return { runtimes: [], diagnosis: "Could not reach the Melon server." };
  }
}

export interface ModelListResult {
  ok: boolean;
  models?: string[];
  total?: number;
  label?: string;
  message?: string;
}

/** Ask the provider which models it currently serves. */
export async function listModels(agent: Agent): Promise<ModelListResult> {
  try {
    const res = await fetch("/api/list-models", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: agent.id,
        name: agent.name,
        provider: agent.provider,
        model: agent.model,
        apiKey: agent.apiKey || undefined,
        baseUrl: agent.baseUrl || undefined,
        role: agent.role,
      }),
    });
    return res.json();
  } catch {
    return { ok: false, message: "Could not reach the Melon server." };
  }
}

export async function testAgent(agent: Agent): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await fetch("/api/test-agent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: agent.id,
        name: agent.name,
        provider: agent.provider,
        model: agent.model,
        apiKey: agent.apiKey || undefined,
        baseUrl: agent.baseUrl || undefined,
        role: agent.role,
      }),
    });
    return res.json();
  } catch {
    return { ok: false, message: "Could not reach the Melon server." };
  }
}

/**
 * fetch with a deadline. Without one, a server that is down but still holding
 * the port leaves the UI hanging for many seconds with no explanation.
 */
async function fetchJson<T>(url: string, timeoutMs = 4000, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    if (!res.ok) throw new Error(`${url} returned ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

export async function getRegistry(): Promise<RegistryInfo> {
  return fetchJson<RegistryInfo>("/api/registry");
}

export async function getGuard(): Promise<GuardState> {
  const res = await fetch("/api/guard");
  return res.json();
}

export async function resetGuard(): Promise<void> {
  await fetch("/api/guard/reset", { method: "POST" });
}

export async function stopTokenFlow(): Promise<void> {
  await fetch("/api/stop", { method: "POST" });
}

function deviceProfile(): { cores?: number; memoryGb?: number } {
  const nav = navigator as Navigator & { deviceMemory?: number };
  return { cores: nav.hardwareConcurrency, memoryGb: nav.deviceMemory };
}

export async function runConversation(
  userMessage: string,
  history: HistoryTurn[],
  agents: Agent[],
  settings: Settings & { burst?: boolean },
  groupPersonalities: Record<string, string>,
  attachments: Attachment[],
  callbacks: RunCallbacks
): Promise<void> {
  const body = {
    userMessage,
    history,
    settings,
    attachments,
    device: deviceProfile(),
    agents: agents.map((a) => ({
      id: a.id,
      name: a.name,
      provider: a.provider,
      model: a.model,
      apiKey: a.apiKey || undefined,
      baseUrl: a.baseUrl || undefined,
      role: a.role,
      personality: a.personality || undefined,
      groupPersonality: groupPersonalities[a.role]?.trim() || undefined,
      team: a.team ?? 1,
    })),
  };

  let res: Response;
  try {
    res = await fetch("/api/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    callbacks.onError(err instanceof Error ? err.message : "Network error");
    return;
  }
  if (!res.ok || !res.body) {
    callbacks.onError(`Server error (${res.status})`);
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let currentEvent = "";
  let stopped = false;

  const handle = (event: string, raw: string) => {
    let data: any;
    try {
      data = JSON.parse(raw);
    } catch {
      return;
    }
    switch (event) {
      case "round-start":
        callbacks.onRoundStart(data.round);
        break;
      case "agent-start":
        callbacks.onAgentStart(data.agentId, data.round);
        break;
      case "token":
        callbacks.onToken(data.agentId, data.text, data.round);
        break;
      case "agent-done":
        callbacks.onAgentDone(data.agentId, data.usage, data.round, {
          finishReason: data.finishReason,
          replyLimit: data.replyLimit,
        });
        break;
      case "agent-error":
        callbacks.onAgentError(data.agentId, data.message, data.round);
        break;
      case "agent-stopped":
        callbacks.onAgentStopped(data.agentId, data.round);
        break;
      case "agent-throttled":
        callbacks.onAgentThrottled(data.agentId, data.round);
        break;
      case "context-full":
        callbacks.onContextFull(data.used, data.limit);
        break;
      case "rate":
        callbacks.onRate(data.rate, data.spent, data.limit);
        break;
      case "pacing":
        callbacks.onPacing(data.waitMs);
        break;
      case "concluded":
        callbacks.onConcluded();
        break;
      case "throttle":
        callbacks.onThrottle(data.limit, data.reasons ?? []);
        break;
      case "budget-stop":
        callbacks.onBudgetStop(data.budget, data.usedOutputTokens);
        break;
      case "guard":
        callbacks.onGuard(data);
        break;
      case "run-stopped":
        stopped = true;
        break;
      case "error":
        callbacks.onError(data.message);
        break;
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, idx).replace(/\r$/, "");
      buffer = buffer.slice(idx + 1);
      if (line.startsWith("event:")) {
        currentEvent = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        handle(currentEvent, line.slice(5).trimStart());
      }
    }
  }
  callbacks.onRunEnd(stopped);
}

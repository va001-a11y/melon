import { RUNS_LOCALLY } from "./target";
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
  if (RUNS_LOCALLY) return (await import("@melon/core")).analytics.snapshot();
  const res = await fetch("/api/analytics");
  return res.json();
}

export async function resetAnalytics(): Promise<void> {
  if (RUNS_LOCALLY) {
    (await import("@melon/core")).analytics.reset();
    return;
  }
  await fetch("/api/analytics/reset", { method: "POST" });
}

export async function flagResponse(provider: string, model: string): Promise<void> {
  if (RUNS_LOCALLY) {
    (await import("@melon/core")).analytics.recordFlag(provider, model);
    return;
  }
  await fetch("/api/analytics/flag", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ provider, model }),
  });
}

export async function getMarketplace(): Promise<{ bundles: Bundle[] }> {
  if (RUNS_LOCALLY) return { bundles: (await import("@melon/core")).BUNDLES as Bundle[] };
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
  if (RUNS_LOCALLY) {
    // A page cannot scan the visitor's machine for model runtimes, and should
    // not try. Say so plainly rather than reporting "nothing found".
    return {
      runtimes: [],
      diagnosis:
        "Local model runtimes can't be detected from a web page. Ollama, LM Studio and llama.cpp " +
        "need the desktop version of Melon, which runs on your machine and can reach them.",
    };
  }
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


/** The subset of an agent a provider call needs. */
function toSpec(agent: Agent) {
  return {
    id: agent.id,
    name: agent.name,
    provider: agent.provider,
    model: agent.model,
    apiKey: agent.apiKey || undefined,
    baseUrl: agent.baseUrl || undefined,
    role: agent.role,
  };
}

/** Ask the provider which models it currently serves. */
export async function listModels(agent: Agent): Promise<ModelListResult> {
  if (RUNS_LOCALLY) {
    // Straight to the provider — same code the server route runs.
    const { listModelsFor } = await import("@melon/core");
    return listModelsFor(toSpec(agent));
  }
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
  if (RUNS_LOCALLY) {
    const { testAgentConnection } = await import("@melon/core");
    return testAgentConnection(toSpec(agent));
  }
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
  if (RUNS_LOCALLY) {
    // The catalog is data, not a service — in this build it is simply imported.
    const core = await import("@melon/core");
    return {
      providers: core.PROVIDERS as RegistryInfo["providers"],
      models: core.MODEL_REGISTRY as RegistryInfo["models"],
      endpoints: core.COMPAT_PROVIDERS as RegistryInfo["endpoints"],
      hardCap: core.HARD_AGENT_CAP,
      recommended: core.RECOMMENDED_AGENTS,
    };
  }
  return fetchJson<RegistryInfo>("/api/registry");
}

export async function getGuard(): Promise<GuardState> {
  if (RUNS_LOCALLY) {
    const { tokenGuard } = await import("@melon/core");
    return {
      session: tokenGuard.sessionUsage(),
      budget: tokenGuard.getBudget(),
      remainingFraction: tokenGuard.remainingFraction(),
    };
  }
  const res = await fetch("/api/guard");
  return res.json();
}

export async function resetGuard(): Promise<void> {
  if (RUNS_LOCALLY) {
    (await import("@melon/core")).tokenGuard.reset();
    return;
  }
  await fetch("/api/guard/reset", { method: "POST" });
}

export async function stopTokenFlow(): Promise<void> {
  if (RUNS_LOCALLY) {
    // Aborts the very AbortController the orchestrator registered for this
    // run — the same mechanism the server endpoint reaches for.
    (await import("@melon/core")).stopController.stopAll();
    return;
  }
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
      webSearch: a.webSearch === true,
      team: a.team ?? 1,
    })),
  };

  // The hosted build has no server to post to — the core runs right here.
  if (RUNS_LOCALLY) {
    await runLocally(body, callbacks);
    return;
  }

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
    if (dispatch(event, data, callbacks)) stopped = true;
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

/**
 * Turn one orchestrator event into the matching callback.
 *
 * Transport-independent on purpose: the events are the same whether they
 * arrived as SSE frames from a local server or came straight out of the core
 * running in this page. Returns true for the event that means "the user
 * stopped this run", which the caller reports at the end.
 */
function dispatch(event: string, data: any, callbacks: RunCallbacks): boolean {
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
        return true;
      case "error":
        callbacks.onError(data.message);
        break;
    }
  return false;
}

/**
 * Run the conversation inside this page, with no server involved.
 *
 * The orchestrator is the same code the desktop build runs; only the sink it
 * emits through differs. There the sink writes SSE frames down an HTTP
 * response, and this file parses them back out again — a round trip that
 * exists purely because the two halves were in different processes. Here the
 * events go straight to the callbacks.
 *
 * Imported dynamically so the desktop build never ships the core to the
 * browser: Vite splits it into a chunk that only the hosted build loads.
 */
async function runLocally(body: unknown, callbacks: RunCallbacks): Promise<void> {
  let core: typeof import("@melon/core");
  try {
    core = await import("@melon/core");
  } catch (err) {
    callbacks.onError(err instanceof Error ? err.message : "Could not load the Melon core.");
    return;
  }

  let stopped = false;
  let ended = false;

  const sink = {
    send(event: string, data: unknown) {
      // The orchestrator may emit after end() in edge cases; ignore rather
      // than surfacing events for a run the UI has already closed out.
      if (ended) return;
      if (dispatch(event, data, callbacks)) stopped = true;
    },
    end() {
      ended = true;
    },
    onClose(_handler: () => void) {
      /*
       * There is no connection to lose here — the consumer is the page
       * itself. Stop is delivered through stopController instead, which
       * aborts the same AbortController the orchestrator registered, so
       * nothing is lost by leaving this empty.
       */
    },
  };

  try {
    await core.runConversation(body as Parameters<typeof core.runConversation>[0], sink);
  } catch (err) {
    callbacks.onError(err instanceof Error ? err.message : String(err));
  }
  callbacks.onRunEnd(stopped);
}

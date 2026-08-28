import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  Agent,
  AgentResponse,
  Attachment,
  Bundle,
  ChatMeta,
  GuardState,
  Message,
  Preset,
  RunMessage,
  Settings,
} from "./types";
import { COST_CONFIRM_THRESHOLD, DEFAULT_SETTINGS, AGENT_COLORS, MODES, makeId } from "./defaults";
import { flagResponse, getGuard, getRegistry, resetGuard, runConversation, stopTokenFlow } from "./api";
import { DEFAULT_THEME_CHOICE, applyTheme, migrateThemeChoice, watchSystemScheme } from "./themes";
import type { ThemeChoice } from "./themes";
import { Settings as SettingsModal } from "./Settings";
import { Analytics } from "./Analytics";
import { Marketplace } from "./Marketplace";
import { estimateRun, formatUsd } from "./cost";
import type { HistoryTurn } from "./api";
import { splitCot } from "./cot";
import { Sidebar } from "./Sidebar";
import { ChatView } from "./ChatView";
import { TopBar } from "./TopBar";
import type { RegistryInfo } from "./types";

/**
 * Melon's storage keys were once prefixed `vedai.`, from the project's original
 * name. Renaming them without this would look exactly like data loss: the app
 * would read `melon.agents`, find nothing, and present an empty install to
 * someone whose chats, agents and keys are all still sitting in the browser
 * under the old names.
 *
 * Runs at module load, before any state initialiser below reads storage. It is
 * idempotent — once the old keys are gone there is nothing left to match — so
 * it needs no "already migrated" flag of its own.
 */
function migrateLegacyKeys(): void {
  try {
    // Snapshot the names first; the loop mutates the store as it goes.
    for (const key of Object.keys(localStorage)) {
      if (!key.startsWith("vedai.")) continue;
      const renamed = `melon.${key.slice("vedai.".length)}`;
      const value = localStorage.getItem(key);
      // Never clobber a newer value that already exists under the new name.
      if (value !== null && localStorage.getItem(renamed) === null) {
        localStorage.setItem(renamed, value);
      }
      localStorage.removeItem(key);
    }
  } catch {
    // Storage can be unavailable (private browsing, blocked cookies). The app
    // already tolerates that everywhere else, so failing here is survivable.
  }
}

migrateLegacyKeys();

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Stored values are not trustworthy: they may come from an older build, a
 * half-finished write, or hand-editing. `loadJson` already survives invalid
 * JSON, but *valid* JSON of the wrong shape is the dangerous case — a preset
 * missing its `activeIds` array reads back fine and then throws during render,
 * taking the whole app down. These shape the data on the way in, so one bad
 * record is dropped instead of being fatal.
 */
function loadList<T>(key: string, normalise: (raw: Record<string, unknown>) => T | null): T[] {
  const raw = loadJson<unknown>(key, []);
  if (!Array.isArray(raw)) return [];
  const out: T[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const shaped = normalise(item as Record<string, unknown>);
    if (shaped) out.push(shaped);
  }
  return out;
}

/** A record of string→string, with anything else discarded. */
function loadStringRecord(key: string): Record<string, string> {
  const raw = loadJson<unknown>(key, {});
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "string") out[k] = v;
  }
  return out;
}

const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);

function normaliseAgent(raw: Record<string, unknown>): Agent | null {
  // Without an id an agent cannot be toggled, edited or removed — drop it.
  if (typeof raw.id !== "string") return null;
  return {
    id: raw.id,
    name: str(raw.name, "Unnamed agent"),
    provider: str(raw.provider, "anthropic") as Agent["provider"],
    model: str(raw.model),
    apiKey: str(raw.apiKey),
    baseUrl: str(raw.baseUrl),
    role: str(raw.role, "generalist"),
    personality: str(raw.personality),
    active: raw.active === true,
    color: str(raw.color, AGENT_COLORS[0]),
    // Normalising rebuilds each agent field by field, so anything not listed
    // here is silently dropped on reload — this has to stay in step with the
    // Agent type.
    webSearch: raw.webSearch === true,
    team: typeof raw.team === "number" && raw.team > 0 ? raw.team : 1,
  };
}

function normalisePreset(raw: Record<string, unknown>): Preset | null {
  if (typeof raw.id !== "string") return null;
  return {
    id: raw.id,
    name: str(raw.name, "Untitled preset"),
    // The field whose absence crashed the sidebar.
    activeIds: Array.isArray(raw.activeIds) ? raw.activeIds.filter((v): v is string => typeof v === "string") : [],
    teams: raw.teams && typeof raw.teams === "object" ? (raw.teams as Record<string, number>) : undefined,
    teamNames: raw.teamNames && typeof raw.teamNames === "object" ? (raw.teamNames as Record<string, string>) : undefined,
    teamBriefs:
      raw.teamBriefs && typeof raw.teamBriefs === "object" ? (raw.teamBriefs as Record<string, string>) : undefined,
  };
}

function normaliseChatMeta(raw: Record<string, unknown>): ChatMeta | null {
  if (typeof raw.id !== "string") return null;
  return {
    id: raw.id,
    title: str(raw.title, "Untitled chat"),
    updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : 0,
    customTitle: raw.customTitle === true ? true : undefined,
  };
}

/**
 * Shape a stored chat into messages the view can render.
 *
 * Two jobs. First, a chat loaded from storage can't still be streaming, so
 * transient statuses are settled. Second, and less obviously, every field the
 * view dereferences has to actually be there: `ChatView` maps over
 * `agentOrder` directly, so a run block saved without one — by an older build,
 * or by a write cut short — throws mid-render and takes the page down. Rather
 * than drop such a block, its order is rebuilt from the responses it does have,
 * which keeps the conversation readable.
 */
function sanitizeMessages(raw: unknown): Message[] {
  if (!Array.isArray(raw)) return [];
  const out: Message[] = [];

  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const m = item as Record<string, unknown>;

    if (m.kind === "user") {
      if (typeof m.text !== "string") continue;
      out.push({
        id: str(m.id, makeId()),
        kind: "user",
        text: m.text,
        attachments: Array.isArray(m.attachments) ? (m.attachments as Attachment[]) : undefined,
      });
      continue;
    }

    if (m.kind !== "run") continue;

    const responses: Record<string, AgentResponse> =
      m.responses && typeof m.responses === "object" && !Array.isArray(m.responses)
        ? { ...(m.responses as Record<string, AgentResponse>) }
        : {};

    for (const id of Object.keys(responses)) {
      const r = responses[id];
      if (!r || typeof r !== "object") {
        delete responses[id];
        continue;
      }
      if (r.status === "streaming" || r.status === "pending") {
        responses[id] = { ...r, status: "stopped" };
      }
      /*
       * Citations become clickable links, so re-check them here rather than
       * trusting that they came from the collector that first filtered them.
       * These arrive from localStorage, which is editable by hand and by any
       * script that has run on this origin — a stored `javascript:` URL would
       * otherwise be rendered as a live link.
       */
      const cites = responses[id].citations;
      if (cites !== undefined) {
        const safe = Array.isArray(cites)
          ? cites.filter(
              (c): c is { url: string; title?: string } =>
                !!c && typeof c === "object" && typeof c.url === "string" && /^https?:\/\//i.test(c.url)
            )
          : [];
        responses[id] = { ...responses[id], citations: safe.length > 0 ? safe : undefined };
      }
    }

    out.push({
      id: str(m.id, makeId()),
      kind: "run",
      // Fall back to the responses' own keys rather than losing the block.
      agentOrder: Array.isArray(m.agentOrder)
        ? m.agentOrder.filter((v): v is string => typeof v === "string")
        : Object.keys(responses),
      responses,
      round: typeof m.round === "number" ? m.round : undefined,
    });
  }

  return out;
}

function chatTitle(messages: Message[]): string {
  const firstUser = messages.find((m) => m.kind === "user");
  return firstUser && firstUser.kind === "user" ? firstUser.text.slice(0, 42) : "New chat";
}

export default function App() {
  const [agents, setAgents] = useState<Agent[]>(() => loadList("melon.agents", normaliseAgent));
  const [settings, setSettings] = useState<Settings>(() => ({
    ...DEFAULT_SETTINGS,
    ...loadJson<Partial<Settings>>("melon.settings", {}),
  }));
  const [showAnalytics, setShowAnalytics] = useState(false);
  const [showMarketplace, setShowMarketplace] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  /** On narrow screens the sidebar is a drawer rather than a fixed column. */
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [theme, setTheme] = useState<ThemeChoice>(() =>
    migrateThemeChoice(loadJson<unknown>("melon.theme", DEFAULT_THEME_CHOICE))
  );
  const [contextLimit, setContextLimit] = useState(0);
  const [burnRate, setBurnRate] = useState(0);
  const [pacing, setPacing] = useState(false);
  const [concluded, setConcluded] = useState(false);
  /** Tone/personality used by the previous run, to detect a mid-chat change. */
  const lastStyleRef = useRef<{ mode: string; personality: string } | null>(null);
  const [groupPersonalities, setGroupPersonalities] = useState<Record<string, string>>(() =>
    loadStringRecord("melon.groupPersonalities")
  );
  const [presets, setPresets] = useState<Preset[]>(() => loadList("melon.presets", normalisePreset));
  const [teamNames, setTeamNames] = useState<Record<string, string>>(() => loadStringRecord("melon.teamNames"));
  const [teamBriefs, setTeamBriefs] = useState<Record<string, string>>(() => loadStringRecord("melon.teamBriefs"));
  const [chatsIndex, setChatsIndex] = useState<ChatMeta[]>(() => loadList("melon.chats.index", normaliseChatMeta));
  const [chatId, setChatId] = useState<string>(() => loadJson("melon.currentChat", makeId()));
  const [messages, setMessages] = useState<Message[]>(() =>
    sanitizeMessages(loadJson<Message[]>(`melon.chat.${loadJson("melon.currentChat", "")}`, []))
  );
  const [running, setRunning] = useState(false);
  const [burst, setBurst] = useState(false);
  const [registry, setRegistry] = useState<RegistryInfo | null>(null);
  const [guard, setGuard] = useState<GuardState | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const runningRef = useRef(false);

  useEffect(() => localStorage.setItem("melon.agents", JSON.stringify(agents)), [agents]);
  useEffect(() => localStorage.setItem("melon.settings", JSON.stringify(settings)), [settings]);
  useEffect(
    () => localStorage.setItem("melon.groupPersonalities", JSON.stringify(groupPersonalities)),
    [groupPersonalities]
  );
  useEffect(() => localStorage.setItem("melon.presets", JSON.stringify(presets)), [presets]);
  useEffect(() => localStorage.setItem("melon.teamNames", JSON.stringify(teamNames)), [teamNames]);
  useEffect(() => localStorage.setItem("melon.teamBriefs", JSON.stringify(teamBriefs)), [teamBriefs]);
  useEffect(() => {
    localStorage.setItem("melon.theme", JSON.stringify(theme));
    applyTheme(theme);
    // Re-apply when the device flips, so the pairing switches live.
    return watchSystemScheme(() => applyTheme(theme));
  }, [theme]);
  useEffect(() => localStorage.setItem("melon.chats.index", JSON.stringify(chatsIndex)), [chatsIndex]);
  useEffect(() => localStorage.setItem("melon.currentChat", JSON.stringify(chatId)), [chatId]);

  // Persist the current chat whenever it settles (never mid-stream).
  useEffect(() => {
    if (running || messages.length === 0) return;
    localStorage.setItem(`melon.chat.${chatId}`, JSON.stringify(messages));
    setChatsIndex((prev) => {
      const existing = prev.find((c) => c.id === chatId);
      const meta: ChatMeta = {
        id: chatId,
        // A title the user typed is never overwritten by the first message.
        title: existing?.customTitle ? existing.title : chatTitle(messages),
        customTitle: existing?.customTitle,
        updatedAt: Date.now(),
      };
      return [meta, ...prev.filter((c) => c.id !== chatId)];
    });
  }, [messages, running, chatId]);

  const loadRegistry = useCallback(async () => {
    try {
      setRegistry(await getRegistry());
      setBanner(null);
    } catch {
      setRegistry(null);
      setBanner(
        "Can't reach the Melon server on port 5175, so providers and presets are unavailable. " +
          "Close the app window and start it again with Melon.bat."
      );
    }
  }, []);

  useEffect(() => {
    void loadRegistry();
    getGuard().then(setGuard).catch(() => undefined);
  }, [loadRegistry]);

  // Selection is activation: click an agent to activate it, Ctrl+click to
  // activate several alongside each other.
  const activeAgents = useMemo(() => agents.filter((a) => a.active), [agents]);

  const updateRun = useCallback((runId: string, agentId: string, patch: (r: RunMessage["responses"][string]) => RunMessage["responses"][string]) => {
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== runId || m.kind !== "run") return m;
        const existing = m.responses[agentId];
        if (!existing) return m;
        return { ...m, responses: { ...m.responses, [agentId]: patch(existing) } };
      })
    );
  }, []);

  /**
   * The conversation as the models should see it.
   *
   * `stopBefore` truncates at a given block, which is what re-running a
   * single agent needs: it must see everything that led up to its turn, but
   * not its own previous attempt or anything that came after.
   */
  const buildHistoryFrom = useCallback(
    (source: Message[], stopBefore?: string): HistoryTurn[] => {
      const history: HistoryTurn[] = [];
      for (const m of source) {
        if (stopBefore && m.id === stopBefore) break;
        if (m.kind === "user") {
          history.push({ role: "user", content: m.text });
          continue;
        }
        for (const agentId of m.agentOrder) {
          const r = m.responses[agentId];
          if (!r || r.status !== "done") continue;
          const { answer, cot } = splitCot(r.text);
          const content = answer || cot;
          if (content) history.push({ role: "assistant", agentName: r.name, content });
        }
      }
      return history;
    },
    []
  );

  const buildHistory = useCallback((): HistoryTurn[] => buildHistoryFrom(messages), [messages, buildHistoryFrom]);

  const historyChars = useMemo(
    () =>
      messages.reduce(
        (n, m) => n + (m.kind === "user" ? m.text.length : Object.values(m.responses).reduce((k, r) => k + r.text.length, 0)),
        0
      ),
    [messages]
  );

  const send = useCallback(
    async (text: string, attachments: Attachment[] = []) => {
      if (runningRef.current || activeAgents.length === 0) return;

      // Preflight cost gate: expensive runs need explicit confirmation.
      const est = estimateRun(activeAgents, settings, historyChars, text.length);
      if (est.usd >= COST_CONFIRM_THRESHOLD) {
        const ok = window.confirm(
          `This run is estimated to cost about ${formatUsd(est.usd)} ` +
            `(${activeAgents.length} agents, ~${(est.inputTokens + est.outputTokens).toLocaleString()} tokens` +
            `${est.hasUnpriced ? ", plus models with unknown pricing" : ""}).\n\nProceed?`
        );
        if (!ok) return;
      }

      runningRef.current = true;
      setRunning(true);
      setBanner(null);
      setConcluded(false);

      const history = buildHistory();

      // Switching tone partway through only sticks if the models are told;
      // the earlier replies in the history otherwise keep setting the style.
      const previous = lastStyleRef.current;
      const styleChangedFrom =
        history.length > 0 &&
        previous &&
        (previous.mode !== settings.mode || previous.personality !== settings.globalPersonality)
          ? MODES.find((m) => m.key === previous.mode)?.label ?? previous.mode
          : undefined;
      lastStyleRef.current = { mode: settings.mode, personality: settings.globalPersonality };

      const blankRound = (round: number): RunMessage => {
        const responses: RunMessage["responses"] = {};
        for (const a of activeAgents) {
          const team = a.team ?? 1;
          responses[a.id] = {
            agentId: a.id,
            name: a.name,
            color: a.color,
            role: a.role,
            text: "",
            status: "pending",
            // Stored on the reply itself so a reopened chat still shows which
            // stage produced it, even if the line-up has changed since.
            team,
            teamName: teamNames[String(team)]?.trim() || undefined,
          };
        }
        return { id: makeId(), kind: "run", agentOrder: activeAgents.map((a) => a.id), responses, round };
      };

      // Each round gets its own block; roundIds[n] is the block for round n.
      const roundIds: string[] = [];
      const first = blankRound(0);
      roundIds.push(first.id);
      setMessages((prev) => [...prev, { id: makeId(), kind: "user", text, attachments }, first]);

      /** Events carry a round index; apply them to that round's block. */
      const at = (round: number | undefined) => roundIds[round ?? 0] ?? roundIds[roundIds.length - 1];

      await runConversation(
        text,
        history,
        activeAgents,
        { ...settings, burst, styleChangedFrom, teamNames, teamBriefs },
        groupPersonalities,
        attachments,
        {
        onRoundStart: (round) => {
          if (round === 0 || roundIds[round]) return;
          const block = blankRound(round);
          roundIds[round] = block.id;
          setMessages((prev) => [...prev, block]);
        },
        onAgentStart: (id, round) =>
          updateRun(at(round), id, (r) => ({ ...r, status: "streaming", startedAt: Date.now() })),
        onToken: (id, chunk, round) => updateRun(at(round), id, (r) => ({ ...r, text: r.text + chunk })),
        onAgentDone: (id, usage, round, meta) =>
          updateRun(at(round), id, (r) => ({
            ...r,
            status: "done",
            usage,
            finishReason: meta?.finishReason as AgentResponse["finishReason"],
            replyLimit: meta?.replyLimit,
            citations: meta?.citations,
          })),
        onAgentError: (id, message, round) =>
          updateRun(at(round), id, (r) => ({ ...r, status: "error", error: message })),
        onAgentStopped: (id, round) => updateRun(at(round), id, (r) => ({ ...r, status: "stopped" })),
        onAgentThrottled: (id, round) => updateRun(at(round), id, (r) => ({ ...r, status: "throttled" })),
        onRate: (rate) => setBurnRate(rate),
        onConcluded: () => setConcluded(true),
        onPacing: (waitMs) => {
          setPacing(true);
          window.setTimeout(() => setPacing(false), waitMs);
        },
        onContextFull: (used, limit) => {
          setContextLimit(limit);
          setBanner(
            `Context window full (~${used.toLocaleString()} of ${limit.toLocaleString()} tokens). ` +
              `The agents have stopped. Press Reset to clear this chat, or start a new one.`
          );
        },
        onThrottle: (limit, reasons) =>
          setBanner(`Auto-throttle: dynamic limit is ${limit} agents right now (${reasons.join("; ")}). Extra agents were skipped.`),
        onBudgetStop: (budget, used) =>
          setBanner(`Token guard: session output budget of ${budget.toLocaleString()} tokens exhausted (~${used.toLocaleString()} used). Run aborted.`),
          onGuard: (g) => setGuard(g),
          onRunEnd: () => undefined,
          onError: (message) => setBanner(message),
        }
      );

      runningRef.current = false;
      setRunning(false);
      setPacing(false);
      setBurst(false); // burst consent is per-run
    },
    [activeAgents, buildHistory, settings, burst, groupPersonalities, updateRun]
  );

  /**
   * Re-run one agent inside an existing reply block.
   *
   *  - "retry"      an agent that errored, unchanged
   *  - "regenerate" a fresh attempt, replacing what it said
   *  - "continue"   pick up from where a cut-off reply stopped
   *
   * Only that agent runs, so a single failed or truncated answer never costs
   * a whole round of everyone else's tokens.
   */
  const rerunAgent = useCallback(
    async (blockId: string, agentId: string, mode: "retry" | "regenerate" | "continue") => {
      if (runningRef.current) return;
      const agent = agents.find((a) => a.id === agentId);
      const block = messages.find((m) => m.id === blockId);
      if (!agent || !block || block.kind !== "run") return;

      const previous = block.responses[agentId];
      const partial = mode === "continue" ? splitCot(previous?.text ?? "").answer : "";

      // The user turn this block was answering, so the agent sees the question.
      const index = messages.findIndex((m) => m.id === blockId);
      const askedFor = [...messages.slice(0, index)].reverse().find((m) => m.kind === "user");
      const question = askedFor && askedFor.kind === "user" ? askedFor.text : "Continue.";

      const history = buildHistoryFrom(messages, blockId);
      if (mode === "continue" && partial) {
        history.push({ role: "user", content: question });
        history.push({ role: "assistant", agentName: agent.name, content: partial });
      }

      const prompt =
        mode === "continue"
          ? "Carry straight on from where your previous message stopped. Do not repeat any of it, do not " +
            "reintroduce the topic, and do not apologise — just continue the sentence and finish the thought."
          : question;

      runningRef.current = true;
      setRunning(true);
      setBanner(null);

      // Clear the old answer for a fresh attempt; keep it when continuing.
      updateRun(blockId, agentId, (r) => ({
        ...r,
        status: "streaming",
        startedAt: Date.now(),
        error: undefined,
        finishReason: undefined,
        text: mode === "continue" ? r.text : "",
      }));

      await runConversation(
        prompt,
        history,
        [agent],
        { ...settings, burst, teamNames, teamBriefs, discussionMode: "single" },
        groupPersonalities,
        [],
        {
          onRoundStart: () => undefined,
          onAgentStart: () => undefined,
          onToken: (id, chunk) => updateRun(blockId, id, (r) => ({ ...r, text: r.text + chunk })),
          onAgentDone: (id, usage, _round, meta) =>
            updateRun(blockId, id, (r) => ({
              ...r,
              status: "done",
              usage,
              finishReason: meta?.finishReason as AgentResponse["finishReason"],
              replyLimit: meta?.replyLimit,
              citations: meta?.citations,
            })),
          onAgentError: (id, message) => updateRun(blockId, id, (r) => ({ ...r, status: "error", error: message })),
          onAgentStopped: (id) => updateRun(blockId, id, (r) => ({ ...r, status: "stopped" })),
          onAgentThrottled: () => undefined,
          onThrottle: () => undefined,
          onBudgetStop: (budget, used) =>
            setBanner(
              `Token guard: session budget of ${budget.toLocaleString()} tokens exhausted (~${used.toLocaleString()} used).`
            ),
          onContextFull: (used, limit) => {
            setContextLimit(limit);
            setBanner(`Context window full (~${used.toLocaleString()} of ${limit.toLocaleString()} tokens).`);
          },
          onRate: (rate) => setBurnRate(rate),
          onPacing: (waitMs) => {
            setPacing(true);
            window.setTimeout(() => setPacing(false), waitMs);
          },
          onConcluded: () => undefined,
          onGuard: (g) => setGuard(g),
          onRunEnd: () => undefined,
          onError: (message) => setBanner(message),
        }
      );

      runningRef.current = false;
      setRunning(false);
      setPacing(false);
    },
    [agents, messages, settings, burst, teamNames, teamBriefs, groupPersonalities, buildHistoryFrom, updateRun]
  );

  // STOP TOKEN FLOW: terminal kill of all in-flight generation. No resume —
  // the platform is immediately ready for whatever the user does next.
  const handleStop = useCallback(async () => {
    try {
      await stopTokenFlow();
    } catch {
      setBanner("Could not reach server to stop — check the backend.");
    }
  }, []);

  /**
   * Reset wipes THIS chat's history in place — same chat, same title, empty.
   * (Starting a fresh conversation is what "+ New" is for.)
   */
  const resetContext = useCallback(async () => {
    if (runningRef.current || messages.length === 0) return;
    if (!window.confirm("Erase every message in this chat? This cannot be undone.")) return;
    setMessages([]);
    setBanner(null);
    localStorage.removeItem(`melon.chat.${chatId}`);
    // Keep the chat in the list (now empty) rather than orphaning its title.
    setChatsIndex((prev) => prev.map((c) => (c.id === chatId ? { ...c, updatedAt: Date.now() } : c)));
    try {
      await resetGuard();
      setGuard(await getGuard());
    } catch {
      /* the local reset is what matters here */
    }
  }, [messages.length, chatId]);

  const toggleBurst = useCallback(() => {
    if (burst) {
      setBurst(false);
      return;
    }
    const ok = window.confirm(
      "Burst mode bypasses the dynamic agent limit for the NEXT run only (hard cap of 100 and the token budget still apply). Expect elevated token burn. Enable burst?"
    );
    if (ok) setBurst(true);
  }, [burst]);

  // Consensus round: agents review each other's answers and reconcile them.
  const runConsensus = useCallback(() => {
    const lastRun = [...messages].reverse().find((m) => m.kind === "run") as RunMessage | undefined;
    if (!lastRun) return;
    const answers = lastRun.agentOrder
      .map((id) => lastRun.responses[id])
      .filter((r) => r && r.status === "done")
      .map((r) => `[${r.name}]: ${splitCot(r.text).answer || splitCot(r.text).cot}`)
      .join("\n\n");
    if (!answers) {
      setBanner("No completed answers in the last round to reconcile.");
      return;
    }
    void send(
      "CONSENSUS ROUND. Review the answers the panel just gave:\n\n" +
        answers +
        "\n\nIdentify where you agree, where you disagree and why, flag any claim you believe is wrong or unverifiable, " +
        "then state your consensus verdict — the answer you think the panel should stand behind."
    );
  }, [messages, send]);

  const newChat = useCallback(() => {
    if (runningRef.current) return;
    setChatId(makeId());
    setMessages([]);
    setBanner(null);
  }, []);

  /**
   * Fork the conversation at a block: copy everything up to and including it
   * into a new chat, then switch to it.
   *
   * The point is to try a different direction — another model, another
   * question — without losing the thread you already have. So the original is
   * never touched: this writes a new chat and leaves the old one exactly as it
   * was, which is what makes the button safe to press out of curiosity.
   *
   * Branches are titled from the original with an arrow, so the sidebar shows
   * where a chat came from without needing a tree view.
   */
  const branchFrom = useCallback(
    (blockId: string) => {
      if (runningRef.current) return;

      const cut = messages.findIndex((m) => m.id === blockId);
      if (cut < 0) return;
      const carried = messages.slice(0, cut + 1);

      const parentTitle = chatsIndex.find((c) => c.id === chatId)?.title ?? chatTitle(messages);
      // Branching a branch shouldn't stack arrows forever.
      const base = parentTitle.split(" ↳ ")[0];

      const newId = makeId();
      try {
        localStorage.setItem(`melon.chat.${newId}`, JSON.stringify(carried));
      } catch {
        setBanner("Couldn't save the branch — browser storage is full or unavailable.");
        return;
      }

      setChatsIndex((prev) => [
        { id: newId, title: `${base} ↳ branch`, customTitle: true, updatedAt: Date.now() },
        ...prev,
      ]);
      setChatId(newId);
      setMessages(carried);
      setBanner(null);
    },
    [messages, chatsIndex, chatId]
  );

  const loadChat = useCallback((id: string) => {
    if (runningRef.current) return;
    setChatId(id);
    setMessages(sanitizeMessages(loadJson<Message[]>(`melon.chat.${id}`, [])));
    setBanner(null);
    // Opening a chat counts as activity, so it rises to the top of the list.
    setChatsIndex((prev) => {
      const found = prev.find((c) => c.id === id);
      if (!found) return prev;
      return [{ ...found, updatedAt: Date.now() }, ...prev.filter((c) => c.id !== id)];
    });
  }, []);

  const renameChat = useCallback((id: string, title: string) => {
    setChatsIndex((prev) => prev.map((c) => (c.id === id ? { ...c, title, customTitle: true } : c)));
  }, []);

  const deleteChat = useCallback(
    (id: string) => {
      localStorage.removeItem(`melon.chat.${id}`);
      setChatsIndex((prev) => prev.filter((c) => c.id !== id));
      if (id === chatId) {
        setChatId(makeId());
        setMessages([]);
      }
    },
    [chatId]
  );

  /** Saving a line-up records its pipeline shape too, not just who is on. */
  const savePreset = useCallback(
    (name: string) => {
      const preset: Preset = {
        id: makeId(),
        name,
        activeIds: agents.filter((a) => a.active).map((a) => a.id),
        teams: Object.fromEntries(agents.map((a) => [a.id, a.team ?? 1])),
        teamNames: { ...teamNames },
        teamBriefs: { ...teamBriefs },
      };
      setPresets((prev) => [...prev, preset]);
    },
    [agents, teamNames, teamBriefs]
  );

  const applyPreset = useCallback((preset: Preset) => {
    setAgents((prev) =>
      prev.map((a) => ({
        ...a,
        active: preset.activeIds.includes(a.id),
        // Older presets have no teams recorded; leave those agents as they are.
        team: preset.teams?.[a.id] ?? a.team ?? 1,
      }))
    );
    if (preset.teamNames) setTeamNames(() => ({ ...preset.teamNames }));
    if (preset.teamBriefs) setTeamBriefs(() => ({ ...preset.teamBriefs }));
  }, []);

  /**
   * Install a preset: new agents, no keys, activated together — and the
   * pipeline they belong to, so a shared workflow arrives intact rather than
   * as a pile of agents the recipient has to arrange by hand.
   */
  const installBundle = useCallback((bundle: Bundle) => {
    setAgents((prev) => [
      ...prev.map((a) => ({ ...a, active: false })),
      ...bundle.agents.map((b, i) => ({
        id: makeId(),
        name: b.name,
        provider: b.provider as Agent["provider"],
        model: b.model,
        apiKey: "",
        baseUrl: b.baseUrl ?? "",
        role: b.role,
        personality: b.personality ?? "",
        active: true,
        color: AGENT_COLORS[(prev.length + i) % AGENT_COLORS.length],
        team: b.team ?? 1,
      })),
    ]);
    if (bundle.teamNames) setTeamNames((prev) => ({ ...prev, ...bundle.teamNames }));
    if (bundle.teamBriefs) setTeamBriefs((prev) => ({ ...prev, ...bundle.teamBriefs }));
  }, []);

  const importAgents = useCallback(
    (incoming: Partial<Agent>[], names?: Record<string, string>, briefs?: Record<string, string>) => {
      setAgents((prev) => [
        ...prev,
        ...incoming.map((b, i) => ({
          id: makeId(),
          name: b.name ?? "Imported agent",
          provider: (b.provider ?? "openai") as Agent["provider"],
          model: b.model ?? "",
          apiKey: "",
          baseUrl: b.baseUrl ?? "",
          role: b.role ?? "generalist",
          personality: b.personality ?? "",
          active: false,
          color: AGENT_COLORS[(prev.length + i) % AGENT_COLORS.length],
          team: b.team ?? 1,
        })),
      ]);
      if (names) setTeamNames((prev) => ({ ...prev, ...names }));
      if (briefs) setTeamBriefs((prev) => ({ ...prev, ...briefs }));
    },
    []
  );

  /** Mark a response as inaccurate — feeds the analytics flag rate. */
  const flagAgentResponse = useCallback(
    (agentId: string) => {
      const agent = agents.find((a) => a.id === agentId);
      if (agent) void flagResponse(agent.provider, agent.model);
    },
    [agents]
  );

  return (
    <div className="app">
      <TopBar
        settings={settings}
        onSettings={setSettings}
        burst={burst}
        onToggleBurst={toggleBurst}
        contextTokens={Math.ceil(historyChars / 4)}
        contextLimit={contextLimit}
        onResetContext={resetContext}
        canReset={messages.length > 0 && !running}
        onOpenSettings={() => setShowSettings(true)}
        burnRate={burnRate}
        paceLimit={settings.tokensPerMinute}
        pacing={pacing}
        running={running}
        onToggleSidebar={() => setSidebarOpen((v) => !v)}
        sidebarOpen={sidebarOpen}
      />
      <div className={`body ${sidebarOpen ? "drawer-open" : ""}`}>
        {/* Tapping outside closes the drawer; inert on desktop. */}
        <div className="drawer-backdrop" onClick={() => setSidebarOpen(false)} />
        <Sidebar
          agents={agents}
          setAgents={setAgents}
          providers={registry?.providers ?? []}
          onOpenAnalytics={() => setShowAnalytics(true)}
          onOpenMarketplace={() => setShowMarketplace(true)}
          onRetryProviders={() => void loadRegistry()}
          teamNames={teamNames}
          setTeamNames={setTeamNames}
          teamBriefs={teamBriefs}
          setTeamBriefs={setTeamBriefs}
          chats={chatsIndex}
          currentChatId={chatId}
          running={running}
          onNewChat={() => {
            newChat();
            // Picking a chat on a phone should reveal it, not leave the drawer covering it.
            setSidebarOpen(false);
          }}
          onLoadChat={(id) => {
            loadChat(id);
            setSidebarOpen(false);
          }}
          onDeleteChat={deleteChat}
          onRenameChat={renameChat}
          presets={presets}
          onSavePreset={savePreset}
          onApplyPreset={applyPreset}
          onDeletePreset={(id) => setPresets((prev) => prev.filter((p) => p.id !== id))}
          groupPersonalities={groupPersonalities}
          setGroupPersonalities={setGroupPersonalities}
          globalPersonality={settings.globalPersonality}
          onGlobalPersonality={(v) => setSettings((s) => ({ ...s, globalPersonality: v }))}
        />
        <ChatView
          messages={messages}
          activeCount={activeAgents.length}
          recommendedMax={registry?.recommended.max ?? 6}
          hardCap={registry?.hardCap ?? 100}
          running={running}
          banner={banner}
          onSend={send}
          estimateFor={(draft) => estimateRun(activeAgents, settings, historyChars, draft.length)}
          onConsensus={runConsensus}
          canConsensus={messages.some((m) => m.kind === "run")}
          onFlag={flagAgentResponse}
          onStop={handleStop}
          parallel={settings.parallel}
          discussionMode={settings.discussionMode}
          contextFull={contextLimit > 0 && Math.ceil(historyChars / 4) >= contextLimit}
          concluded={concluded}
          pacing={pacing}
          paceLimit={settings.tokensPerMinute}
          formatReplies={settings.formatReplies}
          onRerun={(blockId, agentId, mode) => void rerunAgent(blockId, agentId, mode)}
          onBranch={branchFrom}
        />
      </div>

      {showSettings && (
        <SettingsModal
          settings={settings}
          onSettings={setSettings}
          theme={theme}
          onTheme={setTheme}
          onClose={() => setShowSettings(false)}
          hasPipeline={new Set(agents.map((a) => a.team ?? 1)).size > 1}
        />
      )}
      {showAnalytics && <Analytics onClose={() => setShowAnalytics(false)} />}
      {showMarketplace && (
        <Marketplace
          agents={agents}
          onInstall={installBundle}
          onImport={importAgents}
          onClose={() => setShowMarketplace(false)}
          teamNames={teamNames}
          teamBriefs={teamBriefs}
        />
      )}
    </div>
  );
}

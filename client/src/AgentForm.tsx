import { useMemo, useState } from "react";
import type { Agent, ProviderDef } from "./types";
import { ROLES } from "./defaults";
import { detectLocal, listModels, testAgent } from "./api";
import type { LocalRuntime } from "./api";

export interface AgentDraft {
  provider: string;
  model: string;
  name: string;
  apiKey: string;
  baseUrl: string;
  role: string;
  personality: string;
}

export const EMPTY_DRAFT: AgentDraft = {
  provider: "anthropic",
  model: "",
  name: "",
  apiKey: "",
  baseUrl: "",
  role: "generalist",
  personality: "",
};

export function draftFromAgent(a: Agent): AgentDraft {
  return {
    provider: a.provider,
    model: a.model,
    name: a.name,
    apiKey: a.apiKey,
    baseUrl: a.baseUrl,
    role: a.role,
    personality: a.personality,
  };
}

interface Props {
  draft: AgentDraft;
  setDraft: (fn: (d: AgentDraft) => AgentDraft) => void;
  providers: ProviderDef[];
  editingName: string | null;
  onSave: () => void;
  onRetryProviders?: () => void;
}

export function AgentForm({ draft, setDraft, providers, editingName, onSave, onRetryProviders }: Props) {
  const [test, setTest] = useState<{ state: "idle" | "running" | "done"; ok?: boolean; message?: string }>({
    state: "idle",
  });
  const [scan, setScan] = useState<{
    state: "idle" | "running" | "done";
    runtimes: LocalRuntime[];
    diagnosis: string | null;
  }>({ state: "idle", runtimes: [], diagnosis: null });
  const [fetched, setFetched] = useState<{
    state: "idle" | "running" | "done";
    models: string[];
    message?: string;
  }>({ state: "idle", models: [] });

  const def = providers.find((p) => p.id === draft.provider);
  const patch = (p: Partial<AgentDraft>) => setDraft((d) => ({ ...d, ...p }));
  const isLocal = def?.group === "Local" && def.id !== "demo";
  /** Models found on this machine take priority over the generic examples. */
  const detected = scan.runtimes.find((r) => r.id === draft.provider && r.found)?.models ?? [];
  // Live lists beat local scans, which beat the static examples.
  const modelOptions =
    fetched.models.length > 0 ? fetched.models : detected.length > 0 ? detected : def?.exampleModels ?? [];

  const groups = useMemo(() => {
    const map = new Map<string, ProviderDef[]>();
    for (const p of providers) {
      const list = map.get(p.group) ?? [];
      list.push(p);
      map.set(p.group, list);
    }
    return [...map.entries()];
  }, [providers]);

  /**
   * Changing provider clears the old endpoint and key. Carrying a base URL
   * across providers is what made agents post to the wrong service entirely.
   *
   * The model is deliberately left blank rather than pre-filled: providers
   * retire models on their own schedule, so a hardcoded default eventually
   * points at something that no longer exists. Type it, or press Fetch.
   */
  const changeProvider = (id: string) => {
    const next = providers.find((p) => p.id === id);
    setDraft((d) => ({
      ...d,
      provider: id,
      baseUrl: next?.editableBaseUrl ? next.baseUrl ?? "" : "",
      apiKey: "",
      model: "",
    }));
    setTest({ state: "idle" });
    setFetched({ state: "idle", models: [] });
  };

  const fetchModels = async () => {
    setFetched({ state: "running", models: [] });
    const result = await listModels({
      id: "fetch",
      name: draft.name || "fetch",
      provider: draft.provider,
      model: draft.model.trim(),
      apiKey: draft.apiKey.trim(),
      baseUrl: draft.baseUrl.trim(),
      role: draft.role,
      personality: "",
      active: false,
      color: "#000",
    });
    setFetched({
      state: "done",
      models: result.models ?? [],
      message: result.ok ? undefined : result.message,
    });
  };

  const runScan = async () => {
    setScan({ state: "running", runtimes: [], diagnosis: null });
    const { runtimes, diagnosis } = await detectLocal();
    setScan({ state: "done", runtimes, diagnosis });
    // If exactly the current provider was found, adopt its URL and first model.
    const mine = runtimes.find((r) => r.id === draft.provider && r.found);
    if (mine) {
      setDraft((d) => ({
        ...d,
        baseUrl: mine.baseUrl,
        model: d.model.trim() || mine.models[0] || d.model,
      }));
    }
  };

  const runTest = async () => {
    setTest({ state: "running" });
    const result = await testAgent({
      id: "test",
      name: draft.name || "test",
      provider: draft.provider,
      model: draft.model.trim(),
      apiKey: draft.apiKey.trim(),
      baseUrl: draft.baseUrl.trim(),
      role: draft.role,
      personality: "",
      active: false,
      color: "#000",
    });
    setTest({ state: "done", ok: result.ok, message: result.message });
  };

  return (
    <div className="add-form">
      {editingName && <div className="edit-note">Editing “{editingName}”</div>}

      {providers.length === 0 ? (
        <div className="load-failed">
          <p>
            <b>No providers loaded.</b> The list of AI services comes from the Melon server, which isn't responding.
          </p>
          <p className="key-note">
            It should be running at <code>http://localhost:5175</code>. Close this window, restart with{" "}
            <code>Melon.bat</code>, and try again — agents can't be added until it's up.
          </p>
          {onRetryProviders && (
            <button className="small-btn" onClick={onRetryProviders}>
              Try again
            </button>
          )}
        </div>
      ) : (
        <label>
          Provider
          <select value={draft.provider} onChange={(e) => changeProvider(e.target.value)}>
            {groups.map(([group, list]) => (
              <optgroup key={group} label={group}>
                {list.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
      )}

      {def?.note && <p className="provider-note">{def.note}</p>}

      <label>
        Model
        <div className="model-field">
          <input
            list="model-suggestions"
            value={draft.model}
            onChange={(e) => patch({ model: e.target.value })}
            placeholder="type the exact model id"
          />
          <button
            type="button"
            className="small-btn"
            onClick={fetchModels}
            disabled={fetched.state === "running"}
            title="Ask this provider which models it currently serves"
          >
            {fetched.state === "running" ? "…" : "Fetch"}
          </button>
        </div>
        <datalist id="model-suggestions">
          {modelOptions.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
        <small className="field-hint">
          Type the id exactly as the provider writes it — lower case, dashes instead of spaces (e.g.{" "}
          <code>{def?.exampleModels[0] ?? "llama-3.3-70b-versatile"}</code>). Press <b>Fetch</b> to list what this
          provider serves today; models do get retired.
        </small>
        {fetched.state === "done" && fetched.models.length > 0 && (
          <small className="field-hint ok">
            {fetched.models.length} models available — click the box for the list.
          </small>
        )}
        {fetched.state === "done" && fetched.message && <small className="field-hint bad">{fetched.message}</small>}
      </label>

      {isLocal && (
        <div className="detect-box">
          <button className="small-btn" onClick={runScan} disabled={scan.state === "running"}>
            {scan.state === "running" ? "Scanning…" : "Detect local models"}
          </button>
          {scan.state === "done" && (
            <div className="detect-results">
              {scan.runtimes.map((r) => (
                <div key={r.id} className={r.found ? "detect-ok" : "detect-miss"}>
                  {r.found ? "✓" : "✕"} {r.label}
                  {r.found
                    ? r.models.length > 0
                      ? ` — ${r.models.length} model${r.models.length === 1 ? "" : "s"}: ${r.models.slice(0, 4).join(", ")}`
                      : " — running, but no models pulled yet"
                    : " — not running"}
                </div>
              ))}
              {scan.diagnosis && <p className="diagnosis">{scan.diagnosis}</p>}
            </div>
          )}
        </div>
      )}

      {def?.needsKey && (
        <label>
          API key
          <input
            type="password"
            value={draft.apiKey}
            onChange={(e) => patch({ apiKey: e.target.value })}
            placeholder="paste your key"
          />
          {def.keyUrl && (
            <a className="key-link" href={def.keyUrl} target="_blank" rel="noreferrer">
              Get a key ↗
            </a>
          )}
        </label>
      )}

      {def?.editableBaseUrl && (
        <label>
          Base URL
          <input
            value={draft.baseUrl}
            onChange={(e) => patch({ baseUrl: e.target.value })}
            placeholder={def.baseUrl ?? "https://…"}
          />
        </label>
      )}

      <label>
        Display name
        <input value={draft.name} onChange={(e) => patch({ name: e.target.value })} placeholder="(auto)" />
      </label>

      <label>
        Role
        <select value={draft.role} onChange={(e) => patch({ role: e.target.value })}>
          {ROLES.map((r) => (
            <option key={r.key} value={r.key}>
              {r.label}
            </option>
          ))}
        </select>
      </label>

      <label>
        Personality (optional)
        <textarea
          value={draft.personality}
          onChange={(e) => patch({ personality: e.target.value })}
          placeholder="e.g. dry wit, always ends with a haiku"
          rows={2}
        />
      </label>

      <div className="form-actions">
        <button className="primary-btn" onClick={onSave} disabled={!draft.model.trim()}>
          {editingName ? "Save changes" : "Add agent"}
        </button>
        <button className="small-btn" onClick={runTest} disabled={!draft.model.trim() || test.state === "running"}>
          {test.state === "running" ? "Testing…" : "Test connection"}
        </button>
      </div>

      {test.state === "done" && (
        <p className={test.ok ? "test-ok" : "test-fail"}>
          {test.ok ? "✓ " : "✕ "}
          {test.message}
        </p>
      )}

      <p className="key-note">Keys stay in this browser and are sent only to your own Melon server.</p>
    </div>
  );
}

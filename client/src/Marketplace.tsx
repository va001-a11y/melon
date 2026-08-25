import { useEffect, useRef, useState } from "react";
import type { Agent, Bundle } from "./types";
import { getMarketplace } from "./api";

interface Props {
  agents: Agent[];
  onInstall: (preset: Bundle) => void;
  onImport: (
    agents: Partial<Agent>[],
    teamNames?: Record<string, string>,
    teamBriefs?: Record<string, string>
  ) => void;
  teamNames: Record<string, string>;
  teamBriefs: Record<string, string>;
  onClose: () => void;
}

/**
 * A base URL can itself carry a secret — several APIs accept `?key=…`, and a
 * custom endpoint may embed `user:pass@`. Keep only scheme, host and path.
 */
export function sanitiseBaseUrl(raw: string): string {
  const url = raw.trim();
  if (!url) return "";
  try {
    const parsed = new URL(url);
    parsed.search = "";
    parsed.hash = "";
    parsed.username = "";
    parsed.password = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    // Not parseable as a URL: drop anything after a "?" as a precaution.
    return url.split("?")[0].split("#")[0];
  }
}

/**
 * Build the shareable file. Secrets never leave the browser: the API key is
 * omitted entirely and the base URL is stripped of credentials and query
 * parameters. Only the parts needed to recreate the agent are included.
 */
export function exportable(
  agents: Agent[],
  teamNames: Record<string, string> = {},
  teamBriefs: Record<string, string> = {}
) {
  // Only carry the stage labels that are actually in use, so a shared file
  // does not drag along names for teams the recipient will not have.
  const usedTeams = new Set(agents.map((a) => String(a.team ?? 1)));
  const pick = (source: Record<string, string>) =>
    Object.fromEntries(Object.entries(source).filter(([k, v]) => usedTeams.has(k) && v.trim()));

  return {
    kind: "melon-preset",
    version: 3,
    exportedBy: "Melon",
    note: "Contains no API keys. Add your own after importing.",
    teamNames: pick(teamNames),
    teamBriefs: pick(teamBriefs),
    agents: agents.map((a) => ({
      name: a.name,
      provider: a.provider,
      model: a.model,
      role: a.role,
      personality: a.personality,
      baseUrl: sanitiseBaseUrl(a.baseUrl),
      team: a.team ?? 1,
    })),
  };
}

export function Marketplace({ agents, onInstall, onImport, onClose, teamNames, teamBriefs }: Props) {
  const [bundles, setBundles] = useState<Bundle[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "failed">("loading");
  const [note, setNote] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void load();
  }, []);

  const load = async () => {
    setStatus("loading");
    try {
      const r = await getMarketplace();
      setBundles(Array.isArray(r?.bundles) ? r.bundles : []);
      setStatus("ready");
    } catch {
      setBundles([]);
      setStatus("failed");
    }
  };

  const doExport = () => {
    const blob = new Blob([JSON.stringify(exportable(agents, teamNames, teamBriefs), null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `melon-preset-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    const stages = new Set(agents.map((a) => a.team ?? 1)).size;
    setNote(
      `Exported ${agents.length} agent(s)${stages > 1 ? ` and your ${stages}-stage pipeline` : ""} as JSON. ` +
        `No API keys are included, and base URLs are stripped of any credentials — open it in any text editor to ` +
        `check before sharing.`
    );
  };

  const doImport = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text());
      if (!Array.isArray(parsed?.agents)) throw new Error("no agents array");

      // Never adopt a key from a file, even a hand-edited one: it would mean
      // spending someone else's quota, and it tells us they leaked it.
      const carriedKey = parsed.agents.some(
        (a: Record<string, unknown>) => typeof a?.apiKey === "string" && a.apiKey.trim() !== ""
      );
      const clean = parsed.agents.map((a: Record<string, unknown>) => ({
        name: a.name,
        provider: a.provider,
        model: a.model,
        role: a.role,
        personality: a.personality,
        baseUrl: sanitiseBaseUrl(typeof a.baseUrl === "string" ? a.baseUrl : ""),
        // Older exports (v2 and before) have no teams: everything is stage 1.
        team: Number.isInteger(a.team) ? (a.team as number) : 1,
      }));

      const stages = new Set(clean.map((a: { team: number }) => a.team)).size;
      onImport(clean as unknown as Partial<Agent>[], parsed.teamNames ?? {}, parsed.teamBriefs ?? {});
      setNote(
        `Imported ${clean.length} agent(s)${stages > 1 ? ` as a ${stages}-stage pipeline` : ""}. ` +
          `Add your API keys to activate them.` +
          (carriedKey
            ? " ⚠ This file contained an API key. Melon discarded it — tell whoever sent it to revoke that key."
            : "")
      );
    } catch {
      setNote("That file isn't a valid Melon preset.");
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Agent presets</h2>
          <div className="modal-actions">
            <button className="small-btn" onClick={doExport} disabled={agents.length === 0}>
              Export my agents
            </button>
            <button className="small-btn" onClick={() => fileRef.current?.click()}>
              Import preset
            </button>
            <button className="small-btn" onClick={onClose}>
              Close
            </button>
          </div>
        </div>

        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void doImport(f);
            e.target.value = "";
          }}
        />

        {note && <p className="market-note">{note}</p>}

        {status === "loading" && <p className="empty-note">Loading presets…</p>}

        {status === "failed" && (
          <div className="load-failed">
            <p>
              Could not load the ready-made presets — the Melon server isn't responding. It normally runs at{" "}
              <code>http://localhost:5175</code>, started for you by <code>Melon.bat</code> or <code>npm run dev</code>.
            </p>
            <p className="key-note">
              Importing and exporting still work: those happen entirely in your browser and need no server.
            </p>
            <button className="small-btn" onClick={() => void load()}>
              Try again
            </button>
          </div>
        )}

        {status === "ready" && bundles.length === 0 && (
          <p className="empty-note">No ready-made presets are available. You can still import one from a file.</p>
        )}

        <div className="bundle-grid">
          {bundles.map((b) => (
            <div key={b.id} className="bundle-card">
              <div className="bundle-head">
                <span className="bundle-name">{b.name}</span>
                <span className="bundle-tag">{b.tag}</span>
              </div>
              <p className="bundle-desc">{b.description}</p>
              {(() => {
                const stages = [...new Set(b.agents.map((a) => a.team ?? 1))].sort((x, y) => x - y);
                return stages.length > 1 ? (
                  <div className="bundle-pipeline" title="These stages run in order, each handed the previous one's work">
                    {stages.map((t) => b.teamNames?.[String(t)] ?? `Team ${t}`).join(" → ")}
                  </div>
                ) : null;
              })()}
              <ul className="bundle-agents">
                {b.agents.map((a) => (
                  <li key={a.name}>
                    <span className="bundle-agent-name">
                      {(a.team ?? 1) > 1 || b.teamNames ? <span className="bundle-stage">{a.team ?? 1}</span> : null}
                      {a.name}
                    </span>
                    <span className="bundle-agent-model">
                      {a.provider} · {a.model}
                    </span>
                  </li>
                ))}
              </ul>
              <button
                className="primary-btn"
                onClick={() => {
                  onInstall(b);
                  setNote(`Installed “${b.name}”. Add your API keys via right-click → Edit properties.`);
                }}
              >
                Install {b.agents.length} agent{b.agents.length === 1 ? "" : "s"}
              </button>
            </div>
          ))}
        </div>

        <p className="key-note">
          A preset is a ready-made set of agents — provider, model, role and personality already filled in. You add your
          own keys after installing. Presets never contain API keys, and exports omit them too, so a preset file is safe
          to share.
        </p>
      </div>
    </div>
  );
}

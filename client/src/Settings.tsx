import type { Settings, Settings as SettingsType } from "./types";
import { PACE_MAX, PACE_STEP, REPLY_LENGTHS, describePace } from "./defaults";
import { THEMES } from "./themes";
import type { ThemeChoice } from "./themes";
import { useEffect, useRef, useState } from "react";
import { KEY_WARNING, applyBackup, collectBackup, describeBackup } from "./backup";
import type { BackupSummary } from "./backup";
import { SUPPORT_LABEL, SUPPORT_URL } from "./config";
import { SEARCH_PROVIDERS, getSearchProvider } from "@melon/core";

interface Props {
  settings: SettingsType;
  onSettings: (s: SettingsType) => void;
  theme: ThemeChoice;
  onTheme: (choice: ThemeChoice) => void;
  /** True when agents are split across teams, which changes what parallel means. */
  hasPipeline: boolean;
  onClose: () => void;
}

export function Settings({ settings, onSettings, theme, onTheme, onClose, hasPipeline }: Props) {
  // Keep the "Match my system" description truthful if the device changes.

  const fileRef = useRef<HTMLInputElement>(null);
  const [armedForKeys, setArmedForKeys] = useState(false);
  const [pending, setPending] = useState<BackupSummary | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const download = (withKeys: boolean) => {
    const backup = collectBackup(withKeys);
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const day = new Date().toISOString().slice(0, 10);
    /*
     * The filename has to carry the warning too. This file will sit in a
     * Downloads folder for months after the dialog that produced it is
     * forgotten, and by then its name is the only thing left saying what is
     * inside it.
     */
    a.download = backup.containsApiKeys
      ? `melon-backup-CONTAINS-API-KEYS-${day}.json`
      : `melon-backup-${day}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setArmedForKeys(false);
    setNote(
      backup.containsApiKeys
        ? "Downloaded. That file contains your API keys — treat it like a password."
        : "Downloaded. No API keys are in that file, so you will re-enter them after restoring."
    );
  };

  const chooseFile = async (file: File | undefined) => {
    if (!file) return;
    const summary = describeBackup(await file.text());
    if (!summary.ok) {
      setPending(null);
      setNote(summary.problem ?? "That file could not be read.");
      return;
    }
    setNote(null);
    setPending(summary);
  };

  const restore = () => {
    if (!pending?.backup) return;
    applyBackup(pending.backup);
    // Every piece of state in memory is now stale. Reloading is the honest
    // way to adopt the restored data rather than reconciling it by hand.
    window.location.reload();
  };

  const patch = (p: Partial<SettingsType>) => onSettings({ ...settings, ...p });
  const replyKey = REPLY_LENGTHS.find((r) => r.tokens === settings.maxOutputTokens)?.key ?? "custom";

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Settings</h2>
          <button className="small-btn" onClick={onClose}>
            Close
          </button>
        </div>

        <section className="settings-section">
          <h3>Select theme</h3>

          <div className="theme-grid">
            {THEMES.map((t) => (
              <button
                key={t.id}
                className={`theme-card ${theme.selection === t.id ? "chosen" : ""}`}
                onClick={() => onTheme({ ...theme, selection: t.id })}
              >
                <span className={`theme-swatch swatch-${t.id}`} />
                <span className="theme-name">{t.label}</span>
                <span className="theme-desc">{t.description}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="settings-section">
          <h3>Conversation</h3>

          <label className="settings-row">
            <span>
              Reply length
              {/*
                The budget covers reasoning as well as the answer, which is
                invisible until it bites: a reasoning model asked a real
                question can spend all 400 of "Short" thinking and write
                nothing. Saying so here is cheaper than the user finding out
                from a reply that never arrived.
              */}
              <small>
                How much each agent may write per turn, <b>including any reasoning</b> — a model that thinks first
                spends part of the budget there
              </small>
            </span>
            <select
              value={replyKey}
              onChange={(e) => {
                const preset = REPLY_LENGTHS.find((r) => r.key === e.target.value);
                if (preset) patch({ maxOutputTokens: preset.tokens });
              }}
            >
              {REPLY_LENGTHS.map((r) => (
                <option key={r.key} value={r.key}>
                  {r.label} — {r.hint} ({r.tokens.toLocaleString()} tokens)
                </option>
              ))}
              {replyKey === "custom" && <option value="custom">Custom ({settings.maxOutputTokens})</option>}
            </select>
          </label>

          <label className="settings-row">
            <span>
              How agents converse
              <small>
                {settings.discussionMode === "single"
                  ? "Each agent replies once, then it comes back to you"
                  : settings.discussionMode === "until-agreed"
                    ? "They keep talking as long as they need to, and stop themselves once they all agree on a conclusion"
                    : "A fixed number of passes, shown as numbered rounds — for debates and structured arguments"}
              </small>
            </span>
            <select
              value={settings.discussionMode}
              onChange={(e) => patch({ discussionMode: e.target.value as Settings["discussionMode"] })}
            >
              <option value="single">One reply each (default)</option>
              <option value="until-agreed">Talk until they agree</option>
              <option value="rounds">Fixed rounds (debate)</option>
            </select>
          </label>

          {settings.discussionMode === "rounds" && (
            <label className="settings-row">
              <span>
                Number of rounds
                <small>Each agent speaks once per round</small>
              </span>
              <select value={String(settings.rounds)} onChange={(e) => patch({ rounds: Number(e.target.value) })}>
                {[2, 3, 5, 10, 20].map((n) => (
                  <option key={n} value={n}>
                    {n} rounds
                  </option>
                ))}
              </select>
            </label>
          )}

          {settings.discussionMode === "until-agreed" && (
            <p className="settings-note">
              There is no turn limit — the agents decide when they are done. If they never converge, the token budget,
              the context window, or <b>Stop</b> will end it. Setting a budget is wise before leaving this unattended.
            </p>
          )}

          <label className="settings-row checkbox-row">
            <span>
              Answer simultaneously
              {/*
                Two audiences. Someone who has built a pipeline needs to know
                the hand-off between teams survives; someone with a single team
                needs to know the arrangement exists at all, since "everyone
                replies at once" reads like the opposite of a relay and gives
                no hint that the two combine.
              */}
              <small>
                {hasPipeline
                  ? "Off: agents take turns. On: everyone in the same team replies at once — but teams still run one after another, because each needs the previous team's work"
                  : "Off: agents take turns and read each other. On: everyone replies at once. Split agents into teams to get both — parallel within a stage, sequential between them"}
              </small>
            </span>
            <input
              type="checkbox"
              checked={settings.parallel}
              onChange={(e) => patch({ parallel: e.target.checked })}
            />
          </label>

          <label className="settings-row checkbox-row">
            <span>
              Format replies
              <small>
                Render headings, tables, lists and bold properly instead of showing the raw Markdown models write
              </small>
            </span>
            <input
              type="checkbox"
              checked={settings.formatReplies}
              onChange={(e) => patch({ formatReplies: e.target.checked })}
            />
          </label>

          <label className="settings-row checkbox-row">
            <span>
              Show reasoning
              <small>Agents summarise how they reached the answer, in a panel you can expand</small>
            </span>
            <input
              type="checkbox"
              checked={settings.detailedCoT}
              onChange={(e) => patch({ detailedCoT: e.target.checked })}
            />
          </label>
        </section>

        {/*
          Web search for providers that have none.

          Five providers search natively and need nothing here. Everything
          else — Groq, Mistral, DeepSeek, and every local model — has no
          search tool at all, and this is what gives them one. It costs a
          second signup, which is why the free tier is stated next to the
          field rather than discovered later.
        */}
        <section className="settings-section">
          <h3>Web search</h3>

          <label className="settings-row">
            <span>
              Search provider
              <small>
                Gives web search to providers that cannot search on their own, local models included. Providers
                with their own search keep using it
              </small>
            </span>
            <select
              value={settings.searchProvider}
              onChange={(e) => patch({ searchProvider: e.target.value })}
            >
              <option value="">None — only providers with built-in search</option>
              {SEARCH_PROVIDERS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label} — {p.freeTier} free
                </option>
              ))}
            </select>
          </label>

          {settings.searchProvider && (
            <>
              <label className="settings-row">
                <span>
                  Search API key
                  <small>
                    Stored in this browser, exactly like your model keys, and sent only to{" "}
                    {getSearchProvider(settings.searchProvider)?.label ?? "the search provider"}
                  </small>
                </span>
                <input
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="Paste your key"
                  value={settings.searchApiKey}
                  onChange={(e) => patch({ searchApiKey: e.target.value })}
                />
              </label>

              <p className="settings-note">
                {getSearchProvider(settings.searchProvider)?.note}{" "}
                <a
                  href={getSearchProvider(settings.searchProvider)?.signupUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  Get a key
                </a>
                . Results are fetched by Melon and handed to the model as source material — treat what comes
                back with the same care as any web page.
              </p>
            </>
          )}
        </section>

        <section className="settings-section">
          <h3>Spending</h3>

          <div className="settings-row slider-row">
            <span>
              Token pace
              <small>
                Caps how fast output tokens are spent. Agents pause between turns to stay under it, so a long
                discussion stays readable and you have time to press Stop
              </small>
            </span>
            <div className="slider-control">
              <input
                type="range"
                min={0}
                max={PACE_MAX}
                step={PACE_STEP}
                value={settings.tokensPerMinute}
                onChange={(e) => patch({ tokensPerMinute: Number(e.target.value) })}
              />
              <span className="slider-value">{describePace(settings.tokensPerMinute)}</span>
            </div>
          </div>

          <label className="settings-row">
            <span>
              Session token budget
              <small>Runs are stopped once this many output tokens are used. 0 = no limit</small>
            </span>
            <input
              type="number"
              min={0}
              step={1000}
              value={settings.sessionOutputBudget}
              onChange={(e) => patch({ sessionOutputBudget: Math.max(0, Number(e.target.value) || 0) })}
            />
          </label>
        </section>

        <section className="settings-section">
          <h3>Backup and restore</h3>
          <small className="backup-note">
            Melon keeps your chats, agents, settings and API keys in this browser, not in
            Melon's folder — which is why deleting the folder loses nothing. The reverse is
            also true: clearing your browser's site data, switching browser, or reinstalling
            Windows loses all of it, and there is nothing on disk to recover from.
          </small>

          <div className="backup-row">
            <button className="small-btn" onClick={() => { setArmedForKeys(false); download(false); }}>
              Export without API keys
            </button>
            <button className="small-btn danger" onClick={() => setArmedForKeys(true)}>
              Export with API keys
            </button>
          </div>

          {armedForKeys && (
            <div className="backup-warning">
              <strong>This file will contain your API keys, in plain text.</strong>
              <p>{KEY_WARNING}</p>
              <p>
                Anyone who opens it can spend money on your accounts. If you only want to move
                your chats to another computer, export without keys instead and type the keys
                in there.
              </p>
              <div className="backup-row">
                <button className="small-btn danger" onClick={() => download(true)}>
                  I understand — download it with my keys
                </button>
                <button className="small-btn" onClick={() => setArmedForKeys(false)}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          <div className="backup-row">
            <button className="small-btn" onClick={() => fileRef.current?.click()}>
              Restore from a backup…
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(e) => {
                void chooseFile(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </div>

          {pending && (
            <div className="backup-warning">
              <strong>Restoring replaces everything currently in Melon.</strong>
              <p>
                This file holds {pending.chats} {pending.chats === 1 ? "chat" : "chats"} and{" "}
                {pending.agents} {pending.agents === 1 ? "agent" : "agents"}
                {pending.exportedAt ? `, saved ${new Date(pending.exportedAt).toLocaleString()}` : ""}.{" "}
                {pending.containsApiKeys
                  ? "It contains API keys, which will replace the ones you are using now."
                  : "It contains no API keys, so you will need to enter them again afterwards."}
              </p>
              <p>
                Your current chats, agents and settings will be deleted. This cannot be undone,
                so export first if you have anything here worth keeping.
              </p>
              <div className="backup-row">
                <button className="small-btn danger" onClick={restore}>
                  Replace everything and reload
                </button>
                <button className="small-btn" onClick={() => setPending(null)}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          {note && <small className="backup-note">{note}</small>}
        </section>

        {/* Also lives in the top bar, which drops it on narrow screens —
            this is the copy that is always reachable. */}
        {SUPPORT_URL && (
          <section className="settings-section settings-support">
            <a className="coffee-btn" href={SUPPORT_URL} target="_blank" rel="noreferrer noopener">
              ☕ Support
            </a>
            <small>{SUPPORT_LABEL}</small>
          </section>
        )}
      </div>
    </div>
  );
}

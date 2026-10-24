import type { Settings } from "./types";
import { MODES } from "./defaults";
import { SUPPORT_LABEL, SUPPORT_URL } from "./config";

interface Props {
  settings: Settings;
  onSettings: (s: Settings) => void;
  burst: boolean;
  onToggleBurst: () => void;
  contextTokens: number;
  contextLimit: number;
  onResetContext: () => void;
  canReset: boolean;
  onOpenSettings: () => void;
  burnRate: number;
  paceLimit: number;
  pacing: boolean;
  running: boolean;
  /** Opens the drawer on narrow screens; hides or shows the column on wide ones. */
  onToggleSidebar: () => void;
  sidebarShown: boolean;
  narrow: boolean;
}

export function TopBar({
  settings,
  onSettings,
  burst,
  onToggleBurst,
  contextTokens,
  contextLimit,
  onResetContext,
  canReset,
  onOpenSettings,
  burnRate,
  paceLimit,
  pacing,
  running,
  onToggleSidebar,
  sidebarShown,
  narrow,
}: Props) {
  const pct = contextLimit > 0 ? Math.min(100, (contextTokens / contextLimit) * 100) : 0;
  const full = contextLimit > 0 && contextTokens >= contextLimit;

  return (
    <header className="topbar">
      <button
        className="menu-btn"
        onClick={onToggleSidebar}
        aria-expanded={sidebarShown}
        aria-label={sidebarShown ? "Hide agents and chats" : "Show agents and chats"}
        title={sidebarShown ? "Hide agents and chats" : "Show agents and chats"}
      >
        {/* A cross only on the drawer, which covers the chat; on a desktop the
            column sits beside it, so the same icon both hides and shows it. */}
        {narrow && sidebarShown ? "✕" : "☰"}
      </button>

      <div className="brand">
        {/* The word is dropped on very narrow screens; the melon stays. */}
        <span className="brand-mark">
          🍈<span className="brand-word"> Melon</span>
        </span>
      </div>

      <label className="control mode-control">
        <span className="control-label">Mode</span>
        <select
          aria-label="Mode"
          value={settings.mode}
          onChange={(e) => onSettings({ ...settings, mode: e.target.value })}
        >
          {MODES.map((m) => (
            <option key={m.key} value={m.key}>
              {m.label}
            </option>
          ))}
        </select>
      </label>

      <div
        className={`context-panel ${full ? "context-full" : ""}`}
        title={
          full
            ? "The conversation fills the smallest active model's context window. Reset or start a new chat to continue."
            : "Roughly how much of this conversation the agents re-read each turn. Reset erases this chat's messages."
        }
      >
        <div className="context-row">
          <span>
            Context ~{contextTokens.toLocaleString()}
            {contextLimit > 0 && ` / ${contextLimit.toLocaleString()}`} tok
          </span>
          <button className="small-btn" onClick={onResetContext} disabled={!canReset} title="Erase every message in this chat">
            Reset
          </button>
        </div>
        <div className="context-bar">
          <div className={`context-fill ${pct >= 90 ? "hot" : pct >= 65 ? "warm" : ""}`} style={{ width: `${pct}%` }} />
        </div>
      </div>

      {(running || burnRate > 0) && (
        <div
          className={`rate-panel ${pacing ? "pacing" : ""}`}
          title={
            paceLimit > 0
              ? `Output tokens per minute, against your ${paceLimit.toLocaleString()} tok/min pace limit. Change it in Settings → Token pace.`
              : "Output tokens per minute for this run. Set a ceiling in Settings → Token pace."
          }
        >
          <span className="rate-value">
            {pacing ? "pacing…" : `${burnRate.toLocaleString()} tok/min`}
          </span>
          {paceLimit > 0 && (
            <div className="rate-bar">
              <div
                className={`rate-fill ${burnRate >= paceLimit ? "hot" : ""}`}
                style={{ width: `${Math.min(100, (burnRate / paceLimit) * 100)}%` }}
              />
            </div>
          )}
        </div>
      )}

      <button
        className={`burst-btn ${burst ? "armed" : ""}`}
        onClick={onToggleBurst}
        title="Bypass the automatic agent limit for the next run only."
      >
        {burst ? "Burst armed" : "Burst"}
      </button>

      {SUPPORT_URL && (
        <a className="coffee-btn" href={SUPPORT_URL} target="_blank" rel="noreferrer noopener" title={SUPPORT_LABEL}>
          ☕ Support
        </a>
      )}

      <button
        className="settings-btn"
        onClick={onOpenSettings}
        aria-label="Settings"
        title="Settings — themes, discussion length, budget"
      >
        ⚙<span className="settings-word"> Settings</span>
      </button>
    </header>
  );
}

import type { Settings, Settings as SettingsType } from "./types";
import { PACE_MAX, PACE_STEP, REPLY_LENGTHS, describePace } from "./defaults";
import { THEMES } from "./themes";
import type { ThemeChoice } from "./themes";
import { useEffect, useState } from "react";
import { SUPPORT_LABEL, SUPPORT_URL } from "./config";

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
              <small>How much each agent may write per turn</small>
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
                  {r.label} — {r.hint}
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
              <small>
                {hasPipeline
                  ? "Off: agents take turns. On: everyone in the same team replies at once — but teams still run one after another, because each needs the previous team's work"
                  : "Off: agents take turns and read each other. On: everyone replies at once"}
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

import { useEffect, useState } from "react";
import type { AnalyticsSnapshot } from "./types";
import { getAnalytics, resetAnalytics } from "./api";

interface Props {
  onClose: () => void;
}

function ms(n: number): string {
  if (!n) return "—";
  return n >= 1000 ? `${(n / 1000).toFixed(1)}s` : `${Math.round(n)}ms`;
}

function pct(part: number, whole: number): string {
  if (!whole) return "—";
  return `${Math.round((part / whole) * 100)}%`;
}

export function Analytics({ onClose }: Props) {
  const [data, setData] = useState<AnalyticsSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    getAnalytics()
      .then(setData)
      .catch(() => setError("Could not load analytics — is the server running?"));
  };

  useEffect(load, []);

  const maxOut = Math.max(1, ...(data?.models ?? []).map((m) => m.outputTokens));

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Analytics</h2>
          <div className="modal-actions">
            <button className="small-btn" onClick={load}>
              Refresh
            </button>
            <button
              className="small-btn danger"
              onClick={async () => {
                await resetAnalytics();
                load();
              }}
            >
              Reset
            </button>
            <button className="small-btn" onClick={onClose}>
              Close
            </button>
          </div>
        </div>

        {error && <p className="error-text">{error}</p>}

        {data && (
          <>
            <div className="stat-row">
              <div className="stat">
                <span className="stat-value">{data.runs.totalRuns}</span>
                <span className="stat-label">runs</span>
              </div>
              <div className="stat">
                <span className="stat-value">{data.runs.agentInvocations}</span>
                <span className="stat-label">agent calls</span>
              </div>
              <div className="stat">
                <span className="stat-value">{data.runs.burstRuns}</span>
                <span className="stat-label">burst</span>
              </div>
              <div className="stat">
                <span className="stat-value">{data.runs.continuousRounds}</span>
                <span className="stat-label">extra rounds</span>
              </div>
              <div className="stat">
                <span className="stat-value">{data.runs.budgetAborts}</span>
                <span className="stat-label">budget aborts</span>
              </div>
            </div>

            {data.models.length === 0 ? (
              <p className="empty-note">No model activity recorded yet this server session.</p>
            ) : (
              <table className="analytics-table">
                <thead>
                  <tr>
                    <th>Model</th>
                    <th>Calls</th>
                    <th>Success</th>
                    <th>Tokens (in/out)</th>
                    <th>Output share</th>
                    <th>Avg latency</th>
                    <th>First token</th>
                    <th title="Responses you marked inaccurate, over completed calls">Flagged</th>
                  </tr>
                </thead>
                <tbody>
                  {data.models.map((m) => (
                    <tr key={m.key}>
                      <td>
                        <span className="model-name">{m.model}</span>
                        <span className="model-provider">{m.provider}</span>
                      </td>
                      <td>{m.runs}</td>
                      <td title={`${m.errors} errors, ${m.stopped} stopped, ${m.throttled} throttled`}>
                        {pct(m.completed, m.runs)}
                      </td>
                      <td>
                        {m.inputTokens.toLocaleString()} / {m.outputTokens.toLocaleString()}
                      </td>
                      <td>
                        <div className="mini-bar">
                          <div className="mini-fill" style={{ width: `${(m.outputTokens / maxOut) * 100}%` }} />
                        </div>
                      </td>
                      <td>{ms(m.completed ? m.totalMs / m.completed : 0)}</td>
                      <td>{ms(m.firstTokenSamples ? m.totalFirstTokenMs / m.firstTokenSamples : 0)}</td>
                      <td className={m.flagged > 0 ? "flagged-cell" : ""}>
                        {m.flagged > 0 ? `${m.flagged} (${pct(m.flagged, m.completed)})` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <p className="key-note">
              Stats cover this server process (up {ms(data.uptimeMs)}). “Flagged” counts responses you marked inaccurate
              with the ⚑ button on a response card — it is a record of your judgement, not an automatic hallucination
              detector.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

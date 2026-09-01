import { useEffect, useRef, useState } from "react";
import type { AgentResponse, Attachment, Message } from "./types";

import { splitCot } from "./cot";
import { ROLES } from "./defaults";
import { formatUsd } from "./cost";
import type { Estimate } from "./cost";
import { formatSize, prepareFile } from "./files";
import { Markdown } from "./Markdown";

interface Props {
  messages: Message[];
  activeCount: number;
  recommendedMax: number;
  hardCap: number;
  running: boolean;
  banner: string | null;
  onSend: (text: string, attachments: Attachment[]) => void;
  estimateFor: (draft: string) => Estimate;
  onConsensus: () => void;
  canConsensus: boolean;
  onFlag: (agentId: string) => void;
  onStop: () => void;
  parallel: boolean;
  /** Only "rounds" mode labels its passes; the others stay seamless. */
  discussionMode: "single" | "until-agreed" | "rounds";
  contextFull: boolean;
  concluded: boolean;
  pacing: boolean;
  paceLimit: number;
  formatReplies: boolean;
  onRerun: (blockId: string, agentId: string, mode: "retry" | "regenerate" | "continue") => void;
  /** Copy this chat up to and including a block into a new chat. */
  onBranch: (blockId: string) => void;
}


/**
 * The bare domain of a source, shown beside its title so it is obvious where
 * a claim came from without reading the whole URL.
 */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/**
 * Fork the conversation at this point.
 *
 * Deliberately quiet — it only surfaces on hover, because it appears on every
 * block and would otherwise be visual noise on a long chat. The original is
 * never modified: branching copies history into a new chat and leaves this one
 * exactly as it was, so it is always safe to press.
 */
function BranchButton({ onBranch, busy }: { onBranch: () => void; busy: boolean }) {
  return (
    <button
      className="branch-btn"
      onClick={onBranch}
      disabled={busy}
      title={
        busy
          ? "Wait for the current run to finish"
          : "Branch from here — copies the conversation up to this point into a new chat, leaving this one untouched"
      }
    >
      ⑂ Branch from here
    </button>
  );
}

function AgentCard({
  response,
  onFlag,
  readsBefore,
  waitingFor,
  pacing,
  now,
  formatted,
  showTeam,
  onRerun,
  busy,
  agentNames,
}: {
  response: AgentResponse;
  onFlag: (agentId: string) => void;
  readsBefore: string[];
  /** Who this agent is queued behind, in relay mode. */
  waitingFor: string | null;
  pacing: boolean;
  now: number;
  formatted: boolean;
  /** Only worth showing when a run actually spans more than one team. */
  showTeam: boolean;
  onRerun: (agentId: string, mode: "retry" | "regenerate" | "continue") => void;
  busy: boolean;
  /** Everyone in this run, so a reply opening with a teammate's name is caught. */
  agentNames: string[];
}) {
  const { cot, answer, reasoningInProgress } = splitCot(response.text, agentNames);
  const roleLabel = ROLES.find((r) => r.key === response.role)?.label ?? response.role;
  const [flagged, setFlagged] = useState(false);
  const [copied, setCopied] = useState<"no" | "yes" | "failed">("no");
  const [noteDismissed, setNoteDismissed] = useState(false);

  /**
   * Copy the reply, with a fallback and — importantly — a visible failure.
   *
   * `navigator.clipboard` is unavailable in more situations than it looks:
   * a non-secure origin, a browser withholding the permission, or a click the
   * browser does not consider a user gesture. This used to swallow all of
   * those silently, so the button simply did nothing and gave no clue why.
   * The old textarea trick still works in those cases, and if even that
   * fails the button says so rather than pretending.
   */
  const copy = async () => {
    const text = answer || cot;
    const flash = (state: "yes" | "failed") => {
      setCopied(state);
      window.setTimeout(() => setCopied("no"), state === "yes" ? 1500 : 2500);
    };

    try {
      await navigator.clipboard.writeText(text);
      flash("yes");
      return;
    } catch {
      /* fall through to the legacy path */
    }

    try {
      const scratch = document.createElement("textarea");
      scratch.value = text;
      // Kept out of view and out of the tab order, but still selectable —
      // display:none or visibility:hidden would break the copy.
      scratch.setAttribute("readonly", "");
      scratch.style.position = "fixed";
      scratch.style.top = "-1000px";
      scratch.style.opacity = "0";
      document.body.appendChild(scratch);
      scratch.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(scratch);
      flash(ok ? "yes" : "failed");
    } catch {
      flash("failed");
    }
  };
  return (
    <div className={`agent-card status-${response.status}`}>
      <div className="card-head">
        <span className="dot" style={{ background: response.color }} />
        <span className="card-name">{response.name}</span>
        {showTeam && (
          <span
            className="card-team"
            title={`Produced by stage ${response.team ?? 1} of the pipeline${
              (response.team ?? 1) > 1 ? ", working from the earlier stages' output" : ""
            }`}
          >
            <span className="card-team-step">{response.team ?? 1}</span>
            {response.teamName ?? `Team ${response.team ?? 1}`}
          </span>
        )}
        <span className="card-role">{roleLabel}</span>
        <span className="card-status">
          {response.status === "streaming" &&
            (response.startedAt ? `writing… ${Math.max(0, Math.round((now - response.startedAt) / 1000))}s` : "writing…")}
          {response.status === "pending" &&
            (pacing ? "paused to slow spending" : waitingFor ? `waiting for ${waitingFor}` : "waiting")}
          {response.status === "stopped" && "⏹ stopped"}
          {response.status === "throttled" && "⏳ throttled"}
          {response.status === "error" && "⚠ error"}
          {response.status === "done" && response.usage && (
            <span title="input / output tokens">
              {response.usage.inputTokens}/{response.usage.outputTokens} tok
            </span>
          )}
        </span>
        {/*
          In the header rather than down with the other actions, because those
          only appear once a reply has finished — during a long stream there
          was nothing to click, and the button read as missing entirely. Here
          it shows the moment there is anything worth copying.
        */}
        {(answer || cot) && (
          <button
            className={`card-copy ${copied === "yes" ? "copied" : ""} ${copied === "failed" ? "copy-failed" : ""}`}
            onClick={copy}
            aria-label="Copy this reply"
            title={
              copied === "failed"
                ? "Your browser blocked the clipboard — select the text and copy it manually"
                : response.status === "streaming"
                  ? "Copy what has been written so far"
                  : "Copy this reply"
            }
          >
            {copied === "yes" ? "✓" : copied === "failed" ? "✕" : "⧉"}
          </button>
        )}
        {response.status === "done" && (
          <button
            className={`flag-btn ${flagged ? "flagged" : ""}`}
            title={flagged ? "Marked inaccurate" : "Mark this response as inaccurate (feeds Stats)"}
            disabled={flagged}
            onClick={() => {
              setFlagged(true);
              onFlag(response.agentId);
            }}
          >
            ⚑
          </button>
        )}
      </div>
      {readsBefore.length > 0 && (
        <div className="reads-chip" title={`This agent could read: ${readsBefore.join(", ")}`}>
          ↳ read {readsBefore.join(", ")}
        </div>
      )}
      {cot && (
        <details className="cot" open={reasoningInProgress}>
          <summary>Reasoning</summary>
          <div className="cot-body">{cot}</div>
        </details>
      )}
      {answer && (
        <div className={formatted ? "answer answer-md" : "answer"}>
          {formatted ? <Markdown text={answer} /> : answer}
        </div>
      )}
      {/*
        Where the answer came from, when the agent searched. Without this the
        search is invisible: the reply is better informed but there is no way
        to check it, which is the opposite of what a research tool should do.

        Collapsed by default — a search can cite a dozen pages, and expanding
        every card by default would bury the answers.
      */}
      {/*
        An answer with no sources is unverified whether or not search ran, so
        the warning is shown either way — with different wording, because the
        two situations differ: search on and nothing cited means the model had
        the chance and took none, while search off means it answered from
        training data alone.

        Dismissable, because it appears on every sourceless reply and would
        otherwise become wallpaper. Dismissing is per reply and per session:
        the next answer warns again, since that one is a fresh claim.
      */}
      {response.status === "done" && (answer || cot) && !response.citations?.length && !noteDismissed && (
        <div className="cutoff-note unverified-note">
          <span>
            {response.searched ? (
              <>
                <b>No sources returned.</b> Web search was on, but this model cited nothing — so treat any
                specific figures, dates or names below as unverified.
              </>
            ) : (
              <>
                <b>Not checked against sources.</b> This is written from the model's training data, so treat any
                specific figures, dates or names below as unverified.
              </>
            )}
          </span>
          <button
            className="note-dismiss"
            onClick={() => setNoteDismissed(true)}
            aria-label="Hide this notice"
            title="Hide this notice for this reply"
          >
            ✕
          </button>
        </div>
      )}

      {response.citations && response.citations.length > 0 && (
        <details className="sources" open={response.citations.length <= 8}>
          <summary>
            🔗 {response.citations.length} source{response.citations.length === 1 ? "" : "s"}
          </summary>
          <ol>
            {response.citations.map((c) => (
              <li key={c.url}>
                <a href={c.url} target="_blank" rel="noreferrer noopener" title={c.url}>
                  {c.title || hostOf(c.url)}
                </a>
                <span className="source-host">{c.title ? hostOf(c.url) : ""}</span>
              </li>
            ))}
          </ol>
        </details>
      )}

      {/* A reply that stops mid-sentence should always say why. */}
      {response.status === "done" && response.finishReason === "length" && (
        <div className="cutoff-note">
          <b>Cut off early.</b> This model reached the reply-length limit
          {response.replyLimit ? ` of ${response.replyLimit.toLocaleString()} tokens` : ""} and stopped mid-sentence.
          Raise it in <b>Settings → Reply length</b>, or ask it to continue.
        </div>
      )}
      {response.status === "done" && response.finishReason === "filtered" && (
        <div className="cutoff-note">
          <b>Stopped by the provider.</b> Its safety filter ended this reply. Rephrasing the question, or asking a
          different model, usually gets past it.
        </div>
      )}
      {response.status === "error" && <div className="error-text">{response.error}</div>}

      {/* Actions on a finished reply. Re-running one agent costs only that
          agent, rather than a whole round of everyone. */}
      {(response.status === "done" || response.status === "error" || response.status === "stopped") && (
        <div className="card-actions">
          {/* Copy lives in the card header now — it is useful mid-stream too,
              and this row only exists once a reply has finished. */}
          {response.status === "error" && (
            <button className="card-action" onClick={() => onRerun(response.agentId, "retry")} disabled={busy}>
              ↻ Retry
            </button>
          )}
          {response.finishReason === "length" && (
            <button
              className="card-action primary"
              onClick={() => onRerun(response.agentId, "continue")}
              disabled={busy}
              title="Pick up exactly where it stopped"
            >
              ⇥ Continue
            </button>
          )}
          {response.status !== "error" && (
            <button
              className="card-action"
              onClick={() => onRerun(response.agentId, "regenerate")}
              disabled={busy}
              title="Ask this one agent again — the others are not re-run"
            >
              ↻ Regenerate
            </button>
          )}
        </div>
      )}
      {response.status === "stopped" && (
        <div className="cutoff-note">
          <b>You stopped this.</b> {answer ? "The reply ends where you pressed Stop." : "It had not written anything yet."}
        </div>
      )}
      {response.status === "throttled" && (
        <div className="stopped-text">Skipped by auto-throttle — over the current agent limit.</div>
      )}
    </div>
  );
}

export function ChatView({
  messages,
  activeCount,
  recommendedMax,
  hardCap,
  running,
  banner,
  onSend,
  estimateFor,
  onConsensus,
  canConsensus,
  onFlag,
  onStop,
  parallel,
  discussionMode,
  contextFull,
  concluded,
  pacing,
  paceLimit,
  formatReplies,
  onRerun,
  onBranch,
}: Props) {
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [busyFiles, setBusyFiles] = useState(false);
  const [pinned, setPinned] = useState(true);
  const [now, setNow] = useState(() => Date.now());

  // Tick only while something is running, so a wait shows its own duration.
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, [running]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  /**
   * Narrow screens get shorter placeholders. The box sizes itself to fit its
   * own hint, so a placeholder that wraps to two lines makes the empty
   * composer twice as tall as it needs to be before a word is typed.
   */
  const [narrow, setNarrow] = useState(() => window.matchMedia("(max-width: 560px)").matches);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 560px)");
    const onChange = (e: MediaQueryListEvent) => setNarrow(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const placeholder = contextFull
    ? narrow
      ? "Context full — press Reset"
      : "Context window full — press Reset to continue"
    : activeCount === 0
      ? narrow
        ? "Switch on an agent to start"
        : "Click an agent in the sidebar to switch it on"
      : activeCount === 1
        ? "Message your agent…"
        : narrow
          ? `Message ${activeCount} agents…`
          : parallel
            ? `Message ${activeCount} agents (answering at once)…`
            : `Message ${activeCount} agents (taking turns)…`;

  /**
   * Grow the box to fit what has been typed, rather than reserving two rows
   * up front. An empty two-row box cost a tenth of a phone screen before the
   * user had written anything. Capped so a long paste cannot swallow the
   * conversation; past the cap the textarea scrolls internally.
   *
   * scrollHeight counts the placeholder too, so this must re-run when the
   * placeholder changes, not only when the draft does.
   */
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 150)}px`;
  }, [draft, placeholder]);

  /**
   * Follow new output only while the reader is already at the bottom. If they
   * scroll up to re-read something, streaming must not drag them back down.
   */
  useEffect(() => {
    if (pinned) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, pinned]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setPinned(distanceFromBottom < 60);
  };

  const jumpToLatest = () => {
    setPinned(true);
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  };

  const addFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setBusyFiles(true);
    setFileError(null);
    const added: Attachment[] = [];
    const errors: string[] = [];
    for (const file of Array.from(files)) {
      const { attachment, error } = await prepareFile(file);
      if (attachment) added.push(attachment);
      if (error) errors.push(error);
    }
    if (added.length) setAttachments((prev) => [...prev, ...added]);
    if (errors.length) setFileError(errors.join(" "));
    setBusyFiles(false);
  };

  const submit = () => {
    const text = draft.trim();
    if ((!text && attachments.length === 0) || running || activeCount === 0 || contextFull) return;
    setDraft("");
    setAttachments([]);
    setFileError(null);
    setPinned(true);
    onSend(text || "(see attached file)", attachments);
  };

  const estimate = estimateFor(draft);

  return (
    <main className="chat">
      {banner && <div className="warn-banner">{banner}</div>}

      <div className="messages" ref={scrollRef} onScroll={onScroll}>
        {messages.length === 0 && (
          <div className="welcome">
            <h1>🍈 Melon</h1>
            <p>Bring your own models, switch on the ones you want, and let them work through a question together.</p>
            <p className="hint">
              Agents take turns by default, each building on the last. {recommendedMax} or fewer works best; {hardCap} is
              the hard limit.
            </p>
          </div>
        )}
        {messages.map((m) =>
          m.kind === "user" ? (
            <div key={m.id} className="user-msg">
              {m.text}
              {m.attachments && m.attachments.length > 0 && (
                <div className="msg-files">
                  {m.attachments.map((a) => (
                    <span key={a.name} className="msg-file">
                      {a.kind === "image" ? "🖼" : "📄"} {a.name}
                    </span>
                  ))}
                </div>
              )}
              <BranchButton onBranch={() => onBranch(m.id)} busy={running} />
            </div>
          ) : (
            // Teams are read off the stored replies, so a reopened chat is
            // labelled exactly the way it actually ran.
            <div key={m.id} className="run-block">
              {discussionMode === "rounds" && typeof m.round === "number" && m.round > 0 && (
                <div className="round-divider">
                  <span>Round {m.round + 1}</span>
                </div>
              )}
              <div className={parallel ? "run-grid" : "run-relay"}>
                {m.agentOrder.map((id, i) => {
                  const r = m.responses[id];
                  if (!r) return null;
                  const readsBefore = parallel
                    ? []
                    : m.agentOrder
                        .slice(0, i)
                        .map((prevId) => m.responses[prevId])
                        .filter((prev) => prev && prev.status === "done")
                        .map((prev) => prev.name);
                  // In relay, a pending agent is queued behind the one before it.
                  const ahead = parallel
                    ? null
                    : m.agentOrder
                        .slice(0, i)
                        .map((pid) => m.responses[pid])
                        .filter((p) => p && (p.status === "streaming" || p.status === "pending"))
                        .map((p) => p.name)[0] ?? null;
                  return (
                    <AgentCard
                      key={id}
                      response={r}
                      onFlag={onFlag}
                      readsBefore={readsBefore}
                      waitingFor={ahead}
                      pacing={pacing}
                      now={now}
                      formatted={formatReplies}
                      showTeam={new Set(m.agentOrder.map((x) => m.responses[x]?.team ?? 1)).size > 1}
                      onRerun={(agentId, mode) => onRerun(m.id, agentId, mode)}
                      busy={running}
                      agentNames={m.agentOrder.map((x) => m.responses[x]?.name).filter(Boolean) as string[]}
                    />
                  );
                })}
              </div>
              <BranchButton onBranch={() => onBranch(m.id)} busy={running} />
            </div>
          )
        )}
        {concluded && (
          <div className="concluded-note">
            <span>The agents reached a conclusion they all agreed on.</span>
          </div>
        )}
      </div>

      {!pinned && (
        <button className="jump-btn" onClick={jumpToLatest}>
          ↓ Jump to latest
        </button>
      )}

      <div className="composer">
        {pacing && paceLimit > 0 && (
          <div className="pacing-banner">
            ⏳ Deliberately pausing to stay under your {paceLimit.toLocaleString()} tok/min limit. Raise or remove it in
            Settings → Token pace.
          </div>
        )}
        {contextFull && (
          <div className="burn-warning">
            ⛔ This chat has filled the context window. Press Reset, or start a new chat, to continue.
          </div>
        )}
        {activeCount > 0 && !contextFull && (
          <div className="preflight" title="Estimate for one pass. A longer discussion multiplies this.">
            Preflight: ~{estimate.inputTokens.toLocaleString()} in + ~{estimate.outputTokens.toLocaleString()} out across{" "}
            {activeCount} agent{activeCount === 1 ? "" : "s"}
            {discussionMode !== "single" && " per pass"} ·{" "}
            <span className={estimate.usd >= 0.5 ? "cost-hot" : ""}>{formatUsd(estimate.usd)}</span>
            {estimate.freeCount > 0 && ` · ${estimate.freeCount} free`}
            {estimate.hasUnpriced && " · some models unpriced"}
          </div>
        )}
        {activeCount > recommendedMax && (
          <div className="burn-warning">
            ⚠ {activeCount} agents on — above the recommended {recommendedMax}. Expect ~{activeCount}× token burn.
          </div>
        )}

        {attachments.length > 0 && (
          <div className="attachment-row">
            {attachments.map((a, i) => (
              <span key={`${a.name}-${i}`} className="attachment-chip">
                {a.kind === "image" ? "🖼" : "📄"} {a.name} <small>{formatSize(a.size)}</small>
                <button onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))} title="Remove">
                  ✕
                </button>
              </span>
            ))}
          </div>
        )}
        {fileError && <div className="file-error">{fileError}</div>}

        <div className="composer-row">
          <button
            className="attach-btn"
            onClick={() => fileRef.current?.click()}
            disabled={busyFiles}
            title="Attach images, PDFs, or text and code files"
          >
            {busyFiles ? "…" : "📎"}
          </button>
          <input
            ref={fileRef}
            type="file"
            multiple
            style={{ display: "none" }}
            onChange={(e) => {
              void addFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <textarea
            ref={taRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onPaste={(e) => {
              const files = Array.from(e.clipboardData.files);
              if (files.length > 0) {
                e.preventDefault();
                const dt = new DataTransfer();
                files.forEach((f) => dt.items.add(f));
                void addFiles(dt.files);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder={placeholder}
            rows={1}
          />
          <button
            className="primary-btn"
            onClick={submit}
            disabled={running || activeCount === 0 || contextFull || (!draft.trim() && attachments.length === 0)}
          >
            {running ? "…" : "Send"}
          </button>
          <button
            className="stop-btn"
            onClick={onStop}
            disabled={!running}
            aria-label="Stop"
            title="Stop every agent immediately. Stopped replies do not resume."
          >
            {/* The bare square is the universal stop glyph; the word cost
                more width than it earned, especially on a phone. */}
            <span className="stop-square" aria-hidden="true" />
          </button>
        </div>

        {canConsensus && (
          <div className="composer-actions">
            <button
              className="small-btn"
              onClick={onConsensus}
              disabled={running || activeCount === 0 || contextFull}
              title="Send the panel's last answers back to every agent to cross-check and reconcile"
            >
              ⚖ Consensus round
            </button>
          </div>
        )}
      </div>
    </main>
  );
}

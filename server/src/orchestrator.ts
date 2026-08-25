import type { Response } from "express";
import { randomUUID } from "node:crypto";
import type { AgentSpec, Attachment, HistoryTurn, RunRequest, Usage } from "./types.js";
import { resolveTarget } from "./providers/index.js";
import { buildMessages, buildSystemPrompt, COT_END, hasConcluded, stripConclusion } from "./prompts.js";
import type { PriorTurn } from "./prompts.js";
import { stopController } from "./stop.js";
import { HARD_AGENT_CAP } from "./registry.js";
import { contextWindowFor } from "./catalog.js";
import { computeDynamicLimit, estimateTokens, tokenGuard } from "./guard.js";
import { analytics } from "./analytics.js";


/** Sleep that wakes immediately if the user presses Stop. */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted || ms <= 0) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}

interface SseWriter {
  send(event: string, data: unknown): void;
}

function makeSseWriter(res: Response): SseWriter {
  return {
    send(event, data) {
      if (res.writableEnded) return;
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    },
  };
}

/**
 * What an agent is asked on its second and later turns. Naming who spoke
 * most recently gives it something concrete to reply to, which is what makes
 * the exchange read as a conversation rather than parallel monologues.
 */
function continuationPrompt(history: HistoryTurn[], priorThisRound: PriorTurn[], self: string): string {
  // Whoever spoke most recently — this round first, then earlier rounds.
  const recentNames = [
    ...priorThisRound.map((p) => p.agentName),
    ...[...history].reverse().flatMap((t) => (t.role === "assistant" && t.agentName ? [t.agentName] : [])),
  ].filter((n) => n !== self);

  const lastSpeaker = priorThisRound.length
    ? priorThisRound[priorThisRound.length - 1].agentName
    : recentNames[0];

  if (!lastSpeaker) {
    return "Continue — add the next thing worth saying, or say you have nothing to add.";
  }
  const others = [...new Set(recentNames)].slice(0, 3);
  return (
    `${lastSpeaker} has just spoken. Respond to them directly: engage with a specific point ` +
    `${others.length > 1 ? `(from ${others.join(" or ")}) ` : ""}` +
    `raised since your last turn — agree with a reason, push back with a reason, or ask a question. ` +
    `Do not summarise the discussion so far, and do not repeat what you already said. ` +
    `If the discussion has genuinely finished, say so in one sentence.`
  );
}

/**
 * The instruction that closes a pipeline agent's prompt: it is the last thing
 * the model reads, so it must say plainly what to do with the material the
 * earlier teams handed over.
 */
function handoffPrompt(agent: AgentSpec, req: RunRequest, prior: PriorTurn[]): string | undefined {
  const team = agent.team ?? 1;
  if (team <= 1 || prior.length === 0) return undefined;
  const name = req.settings.teamNames?.[String(team)] ?? `Team ${team}`;
  const brief = req.settings.teamBriefs?.[String(team)];
  return (
    `The material above was produced by the earlier stages of this pipeline. ` +
    `You are in "${name}". ${brief ? `Your job: ${brief} ` : ""}` +
    `Work from that material rather than starting again, and produce the finished output for your stage — ` +
    `do not describe what you are doing or address your teammates.`
  );
}

/**
 * Characters of conversation an agent must re-read, as a token estimate.
 * Attachments count: a base64 image or an extracted PDF is often far larger
 * than the message it is attached to, and leaving it out let oversized
 * requests through to the provider.
 */
function contextTokens(history: HistoryTurn[], userMessage: string, attachments: Attachment[] = []): number {
  const chars = history.reduce((n, t) => n + t.content.length, 0) + userMessage.length;
  const attachmentTokens = attachments.reduce(
    // Images cost roughly a token per 750 base64 chars once encoded by the
    // provider; text attachments cost the usual ~4 chars per token.
    (n, a) => n + Math.ceil(a.data.length / (a.kind === "image" ? 750 : 4)),
    0
  );
  return estimateTokens(chars) + attachmentTokens;
}

/**
 * Run one or more rounds of conversation.
 *
 * A round is "every active agent speaks once". With rounds > 1 the agents
 * keep going, each round seeing everything said before it, so they can
 * genuinely debate. The user ends it with STOP; context and budget limits
 * end it automatically.
 */
export async function runConversation(req: RunRequest, res: Response): Promise<void> {
  const runId = randomUUID();
  const sse = makeSseWriter(res);

  if (req.agents.length === 0) {
    sse.send("error", { message: "No agents are switched on. Click an agent in the sidebar first." });
    res.end();
    return;
  }
  if (req.agents.length > HARD_AGENT_CAP) {
    sse.send("error", { message: `Hard cap exceeded: ${req.agents.length} agents requested, maximum is ${HARD_AGENT_CAP}.` });
    res.end();
    return;
  }

  // ── Context window: the smallest active agent decides the ceiling ──
  const smallest = req.agents.reduce(
    (min, a) => Math.min(min, contextWindowFor(a.provider)),
    Number.POSITIVE_INFINITY
  );
  // Leave headroom for the reply itself plus the system prompt.
  const usableWindow = Math.max(1000, smallest - req.settings.maxOutputTokens - 800);
  const startingContext = contextTokens(req.history, req.userMessage, req.attachments ?? []);
  if (startingContext >= usableWindow) {
    sse.send("context-full", { used: startingContext, limit: usableWindow });
    sse.send("error", {
      message:
        `This conversation (~${startingContext.toLocaleString()} tokens) no longer fits the context window of the ` +
        `smallest active model (~${usableWindow.toLocaleString()} usable). Press Reset to clear this chat, start a ` +
        `new one, or switch off the model with the smallest window.`,
    });
    res.end();
    return;
  }

  tokenGuard.setBudget(req.settings.sessionOutputBudget ?? 0);
  if (tokenGuard.exhausted()) {
    sse.send("error", {
      message: `Session output budget (${tokenGuard.getBudget().toLocaleString()} tokens) is exhausted. Raise it in Settings or reset usage.`,
    });
    res.end();
    return;
  }

  const dynamic = computeDynamicLimit({
    device: req.device,
    historyChars: startingContext * 4,
    budgetRemainingFraction: tokenGuard.remainingFraction(),
  });
  const burst = !!req.settings.burst;
  const limit = burst ? HARD_AGENT_CAP : dynamic.limit;
  const reasons = burst ? [`burst mode: dynamic limit ${dynamic.limit} bypassed with user consent`] : dynamic.reasons;
  const runnable = req.agents.slice(0, limit);
  const throttled = req.agents.slice(limit);

  const controller = stopController.register(runId);
  res.on("close", () => controller.abort());

  const parallel = !!req.settings.parallel;
  const teamNames = runnable.map((a) => a.name);
  const mode = req.settings.discussionMode ?? "single";
  // "single" is one pass; "rounds" is a fixed count; "until-agreed" runs
  // until every agent marks agreement (or a brake stops it).
  const plannedRounds = mode === "single" ? 1 : mode === "rounds" ? Math.max(1, req.settings.rounds ?? 3) : 0;
  const untilAgreed = mode === "until-agreed";

  sse.send("run-start", {
    runId,
    agentIds: runnable.map((a) => a.id),
    dynamicLimit: limit,
    burst,
    parallel,
    rounds: plannedRounds,
    mode,
  });
  if (throttled.length > 0) {
    sse.send("throttle", { limit, throttledIds: throttled.map((a) => a.id), reasons });
    for (const agent of throttled) {
      sse.send("agent-throttled", { agentId: agent.id });
      analytics.recordThrottled(agent.provider, agent.model);
    }
  }
  analytics.recordRun({ burst, rounds: plannedRounds || 1, agentCount: runnable.length });

  const totals: Usage = { inputTokens: 0, outputTokens: 0 };
  // Grows as the discussion proceeds so later rounds see everything.
  const runningHistory: HistoryTurn[] = [...req.history];
  let stopReason: string | null = null;

  // ── Token pace: hold the burn rate under the user's ceiling ──
  const pace = Math.max(0, req.settings.tokensPerMinute ?? 0);
  const runStartedAt = Date.now();
  let spentThisRun = 0;

  const currentRate = (): number => {
    const minutes = (Date.now() - runStartedAt) / 60000;
    return minutes > 0.01 ? Math.round(spentThisRun / minutes) : 0;
  };

  /**
   * Pace the stream itself. Agents running at the same time share the
   * allowance, so the combined visible rate stays under the ceiling.
   */
  const perAgentPace = pace > 0 && parallel ? Math.max(60, pace / Math.max(1, runnable.length)) : pace;
  let pacedTokens = 0;

  const paceChunk = async (chars: number): Promise<void> => {
    if (perAgentPace <= 0) return;
    pacedTokens += estimateTokens(chars);
    const owedMs = (pacedTokens / perAgentPace) * 60000 - (Date.now() - runStartedAt);
    // Cap a single wait so one big chunk can't stall the stream outright.
    if (owedMs >= 40) await sleep(Math.min(owedMs, 4000), controller.signal);
  };

  /** Wait long enough that the average rate falls back under the cap. */
  const holdForPace = async (): Promise<void> => {
    if (pace <= 0 || spentThisRun === 0) return;
    const earnedMs = (spentThisRun / pace) * 60000;
    const elapsedMs = Date.now() - runStartedAt;
    const waitMs = Math.min(earnedMs - elapsedMs, 60000);
    if (waitMs < 250) return;
    sse.send("pacing", { waitMs: Math.round(waitMs), rate: currentRate(), limit: pace });
    await sleep(waitMs, controller.signal);
  };

  const runAgent = async (agent: AgentSpec, round: number, priorThisRound: PriorTurn[]): Promise<void> => {
    sse.send("agent-start", { agentId: agent.id, round });
    analytics.recordStart(agent.provider, agent.model);
    const startedAt = Date.now();
    let firstTokenSeen = false;
    let streamedChars = 0;
    try {
      const target = resolveTarget(agent);
      const result = await target.adapter.chat({
        model: agent.model,
        apiKey: agent.apiKey,
        baseUrl: target.baseUrl,
        providerLabel: target.label,
        system: buildSystemPrompt(agent, req.settings, teamNames),
        messages: buildMessages(
          runningHistory,
          round === 0 ? req.userMessage : continuationPrompt(runningHistory, [], agent.name),
          // A later team must always receive the earlier teams' output, even
          // when agents within a team answer simultaneously — that hand-off
          // is the whole point of a pipeline.
          parallel && !isPipeline ? [] : priorThisRound,
          round === 0 ? req.attachments ?? [] : [],
          round === 0
            ? handoffPrompt(agent, req, priorThisRound)
            : continuationPrompt(runningHistory, priorThisRound, agent.name)
        ),
        maxOutputTokens: req.settings.maxOutputTokens,
        signal: controller.signal,
        handlers: {
          onToken: async (text) => {
            if (!firstTokenSeen) {
              firstTokenSeen = true;
              analytics.recordFirstToken(agent.provider, agent.model, Date.now() - startedAt);
            }
            streamedChars += text.length;
            tokenGuard.addInflightChars(text.length);
            sse.send("token", { agentId: agent.id, text, round });
            // Slow the stream to the user's chosen pace.
            await paceChunk(text.length);
            if (tokenGuard.exhausted() && !controller.signal.aborted) {
              analytics.recordBudgetAbort();
              stopReason = "budget";
              sse.send("budget-stop", {
                budget: tokenGuard.getBudget(),
                usedOutputTokens: tokenGuard.usedOutputTokens(),
              });
              controller.abort(new Error("token budget exhausted"));
            }
          },
        },
      });
      tokenGuard.settleInflight(streamedChars);
      const usage =
        result.usage.outputTokens > 0
          ? result.usage
          : { inputTokens: result.usage.inputTokens, outputTokens: estimateTokens(streamedChars) };
      tokenGuard.addUsage(usage);
      totals.inputTokens += result.usage.inputTokens;
      totals.outputTokens += result.usage.outputTokens;
      spentThisRun += usage.outputTokens;
      analytics.recordDone(agent.provider, agent.model, usage, Date.now() - startedAt);
      sse.send("rate", { rate: currentRate(), spent: spentThisRun, limit: pace });

      const raw = result.text.includes(COT_END) ? result.text.split(COT_END).pop()!.trim() : result.text.trim();
      // An agent can mark agreement, or withdraw it by speaking again without.
      if (hasConcluded(raw)) agreed.add(agent.id);
      else agreed.delete(agent.id);

      const answer = stripConclusion(raw).trim();
      if (answer) priorThisRound.push({ agentName: agent.name, content: answer });
      sse.send("agent-done", {
        agentId: agent.id,
        usage: result.usage,
        round,
        agreed: agreed.has(agent.id),
        // Lets the UI explain a reply that stops mid-sentence.
        finishReason: result.finishReason,
        replyLimit: req.settings.maxOutputTokens,
      });
    } catch (err: unknown) {
      tokenGuard.settleInflight(streamedChars);
      tokenGuard.addUsage({ inputTokens: 0, outputTokens: estimateTokens(streamedChars) });
      if (controller.signal.aborted) {
        analytics.recordStopped(agent.provider, agent.model);
        sse.send("agent-stopped", { agentId: agent.id, round });
      } else {
        analytics.recordError(agent.provider, agent.model);
        const message = err instanceof Error ? err.message : String(err);
        sse.send("agent-error", { agentId: agent.id, message, round });
      }
    }
  };

  /** Agents that have marked agreement and not withdrawn it. */
  const agreed = new Set<string>();

  // Teams run one after another, each handed everything the previous ones
  // produced. A line-up with no teams set behaves exactly as before.
  const teamsInOrder = [...new Set(runnable.map((a) => a.team ?? 1))].sort((a, b) => a - b);
  const isPipeline = teamsInOrder.length > 1;

  for (let round = 0; untilAgreed || round < plannedRounds; round++) {
    if (controller.signal.aborted) break;

    // Stop before a round that cannot fit.
    const used = contextTokens(runningHistory, req.userMessage);
    if (round > 0 && used >= usableWindow) {
      stopReason = "context";
      sse.send("context-full", { used, limit: usableWindow });
      break;
    }

    sse.send("round-start", { round, agentIds: runnable.map((a) => a.id) });
    const priorThisRound: PriorTurn[] = [];

    for (const team of teamsInOrder) {
      if (controller.signal.aborted) break;
      const members = runnable.filter((a) => (a.team ?? 1) === team);
      if (members.length === 0) continue;

      if (isPipeline) {
        sse.send("team-start", {
          team,
          round,
          name: req.settings.teamNames?.[String(team)] ?? `Team ${team}`,
          agentIds: members.map((a) => a.id),
        });
      }

      // Within a team, agents answer together or in turn as configured.
      // Across teams it is always sequential — that is what a pipeline is.
      if (parallel) {
        await holdForPace();
        await Promise.all(members.map((a) => runAgent(a, round, priorThisRound)));
      } else {
        for (const agent of members) {
          if (controller.signal.aborted) {
            sse.send("agent-stopped", { agentId: agent.id, round });
            continue;
          }
          await holdForPace();
          if (controller.signal.aborted) {
            sse.send("agent-stopped", { agentId: agent.id, round });
            continue;
          }
          await runAgent(agent, round, priorThisRound);
        }
      }
    }

    // Fold this round into the shared history for the next one.
    if (round === 0) runningHistory.push({ role: "user", content: req.userMessage });
    for (const turn of priorThisRound) {
      runningHistory.push({ role: "assistant", agentName: turn.agentName, content: turn.content });
    }
    // Nobody produced anything — continuing would just burn tokens.
    // (An aborted round is empty too, but that is a stop, not a stall.)
    if (priorThisRound.length === 0) {
      if (!controller.signal.aborted) stopReason = stopReason ?? "no-output";
      break;
    }
    sse.send("round-done", { round });

    // The group decides when it is finished: everyone has marked agreement.
    if (untilAgreed && runnable.every((a) => agreed.has(a.id))) {
      stopReason = "concluded";
      sse.send("concluded", { round, agents: runnable.map((a) => a.name) });
      break;
    }
  }

  stopController.release(runId);
  sse.send("guard", {
    session: tokenGuard.sessionUsage(),
    budget: tokenGuard.getBudget(),
    remainingFraction: tokenGuard.remainingFraction(),
    dynamicLimit: dynamic.limit,
    contextUsed: contextTokens(runningHistory, req.userMessage),
    contextLimit: usableWindow,
    rate: currentRate(),
    spentThisRun,
  });
  if (controller.signal.aborted) {
    sse.send("run-stopped", { runId, reason: stopReason ?? "stopped" });
  } else {
    sse.send("run-done", { runId, totals, reason: stopReason });
  }
  res.end();
}

import type { Usage } from "./types.js";

/**
 * Analytics: per-model performance and usage, accumulated in memory for the
 * life of the server process. Everything here is measured, never inferred —
 * the "accuracy" signal comes from explicit user flags, not guesswork.
 */
export interface ModelStats {
  key: string; // "provider:model"
  provider: string;
  model: string;
  runs: number;
  completed: number;
  errors: number;
  stopped: number;
  throttled: number;
  inputTokens: number;
  outputTokens: number;
  /** Sum of wall-clock ms for completed runs, for averaging. */
  totalMs: number;
  /** Sum of ms to first streamed token, for averaging. */
  totalFirstTokenMs: number;
  firstTokenSamples: number;
  /** Responses the user marked as inaccurate. */
  flagged: number;
}

export interface RunStats {
  totalRuns: number;
  burstRuns: number;
  continuousRounds: number;
  budgetAborts: number;
  agentInvocations: number;
}

function blank(provider: string, model: string): ModelStats {
  return {
    key: `${provider}:${model}`,
    provider,
    model,
    runs: 0,
    completed: 0,
    errors: 0,
    stopped: 0,
    throttled: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalMs: 0,
    totalFirstTokenMs: 0,
    firstTokenSamples: 0,
    flagged: 0,
  };
}

class Analytics {
  private models = new Map<string, ModelStats>();
  private runs: RunStats = {
    totalRuns: 0,
    burstRuns: 0,
    continuousRounds: 0,
    budgetAborts: 0,
    agentInvocations: 0,
  };
  private startedAt = Date.now();

  private entry(provider: string, model: string): ModelStats {
    const key = `${provider}:${model}`;
    let stats = this.models.get(key);
    if (!stats) {
      stats = blank(provider, model);
      this.models.set(key, stats);
    }
    return stats;
  }

  recordRun(opts: { burst: boolean; rounds: number; agentCount: number }): void {
    this.runs.totalRuns++;
    this.runs.agentInvocations += opts.agentCount;
    if (opts.burst) this.runs.burstRuns++;
    this.runs.continuousRounds += Math.max(0, opts.rounds - 1);
  }

  recordBudgetAbort(): void {
    this.runs.budgetAborts++;
  }

  recordStart(provider: string, model: string): void {
    this.entry(provider, model).runs++;
  }

  recordFirstToken(provider: string, model: string, ms: number): void {
    const stats = this.entry(provider, model);
    stats.totalFirstTokenMs += ms;
    stats.firstTokenSamples++;
  }

  recordDone(provider: string, model: string, usage: Usage, ms: number): void {
    const stats = this.entry(provider, model);
    stats.completed++;
    stats.inputTokens += usage.inputTokens;
    stats.outputTokens += usage.outputTokens;
    stats.totalMs += ms;
  }

  recordError(provider: string, model: string): void {
    this.entry(provider, model).errors++;
  }

  recordStopped(provider: string, model: string): void {
    this.entry(provider, model).stopped++;
  }

  recordThrottled(provider: string, model: string): void {
    this.entry(provider, model).throttled++;
  }

  /** User marked a response from this model as inaccurate. */
  recordFlag(provider: string, model: string): void {
    this.entry(provider, model).flagged++;
  }

  snapshot(): { models: ModelStats[]; runs: RunStats; uptimeMs: number } {
    return {
      models: [...this.models.values()].sort((a, b) => b.outputTokens - a.outputTokens),
      runs: { ...this.runs },
      uptimeMs: Date.now() - this.startedAt,
    };
  }

  reset(): void {
    this.models.clear();
    this.runs = { totalRuns: 0, burstRuns: 0, continuousRounds: 0, budgetAborts: 0, agentInvocations: 0 };
    this.startedAt = Date.now();
  }
}

export const analytics = new Analytics();

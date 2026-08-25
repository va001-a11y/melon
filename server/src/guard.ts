import type { Usage } from "./types.js";
import { HARD_AGENT_CAP } from "./registry.js";

/** Rough token estimate for streamed text where the provider hasn't reported usage yet. */
export function estimateTokens(chars: number): number {
  return Math.ceil(chars / 4);
}

export interface DeviceProfile {
  /** navigator.hardwareConcurrency */
  cores?: number;
  /** navigator.deviceMemory (GB) */
  memoryGb?: number;
}

export interface DynamicLimitInput {
  device?: DeviceProfile;
  /** Total characters in conversation history — complexity proxy. */
  historyChars: number;
  /** Fraction of the session output budget remaining (null = unlimited). */
  budgetRemainingFraction: number | null;
}

export interface DynamicLimitResult {
  limit: number;
  reasons: string[];
}

/**
 * Dynamic limit algorithm: how many models may run in parallel right now.
 * Inputs: device profile, conversation complexity, remaining token budget.
 * Always clamped to the hard ceiling of HARD_AGENT_CAP (100).
 */
export function computeDynamicLimit(input: DynamicLimitInput): DynamicLimitResult {
  const reasons: string[] = [];
  const cores = input.device?.cores ?? 4;
  let limit = Math.min(Math.max(cores * 3, 6), 48);
  reasons.push(`device: ${cores} cores → base ${limit}`);

  if (input.device?.memoryGb && input.device.memoryGb < 8) {
    limit = Math.min(limit, input.device.memoryGb * 3);
    reasons.push(`low memory (${input.device.memoryGb}GB) caps at ${limit}`);
  }

  if (input.historyChars > 60000) {
    limit = Math.ceil(limit * 0.5);
    reasons.push("long conversation (>60k chars): halved");
  } else if (input.historyChars > 24000) {
    limit = Math.ceil(limit * 0.75);
    reasons.push("growing conversation (>24k chars): reduced 25%");
  }

  const frac = input.budgetRemainingFraction;
  if (frac !== null) {
    if (frac <= 0.05) {
      limit = 1;
      reasons.push("token budget nearly exhausted (<5%): limited to 1");
    } else if (frac <= 0.2) {
      limit = Math.max(1, Math.ceil(limit * 0.5));
      reasons.push("token budget low (<20%): halved");
    }
  }

  limit = Math.max(1, Math.min(Math.round(limit), HARD_AGENT_CAP));
  return { limit, reasons };
}

/**
 * Token guard: session-wide accounting plus real-time burn tracking.
 * Real usage (provider-reported) is authoritative; while a run streams,
 * an estimate from character counts guards against runaway output.
 */
class TokenGuard {
  private budget = 0; // 0 = unlimited
  private session: Usage = { inputTokens: 0, outputTokens: 0 };
  /** Estimated output tokens of streams still in flight (not yet in session). */
  private inflightChars = 0;

  setBudget(outputTokens: number): void {
    this.budget = Math.max(0, Math.floor(outputTokens) || 0);
  }

  getBudget(): number {
    return this.budget;
  }

  addUsage(usage: Usage): void {
    this.session.inputTokens += usage.inputTokens;
    this.session.outputTokens += usage.outputTokens;
  }

  addInflightChars(chars: number): void {
    this.inflightChars += chars;
  }

  settleInflight(chars: number): void {
    this.inflightChars = Math.max(0, this.inflightChars - chars);
  }

  usedOutputTokens(): number {
    return this.session.outputTokens + estimateTokens(this.inflightChars);
  }

  sessionUsage(): Usage {
    return { ...this.session };
  }

  /** null = unlimited budget. */
  remainingFraction(): number | null {
    if (this.budget <= 0) return null;
    return Math.max(0, (this.budget - this.usedOutputTokens()) / this.budget);
  }

  exhausted(): boolean {
    return this.budget > 0 && this.usedOutputTokens() >= this.budget;
  }

  reset(): void {
    this.session = { inputTokens: 0, outputTokens: 0 };
    this.inflightChars = 0;
  }
}

export const tokenGuard = new TokenGuard();

import type { AgentSpec } from "@melon/core";
import type { Agent } from "./types";

/**
 * Every field of a type, each required to be written — as undefined where it
 * does not apply. Optional fields can otherwise simply be left out, and
 * nothing notices.
 */
type EveryField<T> = { [K in keyof Required<T>]: T[K] };

/**
 * An agent as a run request carries it.
 *
 * Copied field by field, so the page's own bookkeeping (active, colour) stays
 * behind. That is also how "Follow links" was lost: the switch was saved on
 * the agent and shown in its properties, but this list was never told about
 * it, so no run ever followed a link however the switch was set (2026-11-04).
 * The return type now names every field the core reads, so a field added
 * there and forgotten here fails the build instead of disappearing.
 */
export function toRunAgent(a: Agent, groupPersonalities: Record<string, string>): EveryField<AgentSpec> {
  return {
    id: a.id,
    name: a.name,
    provider: a.provider,
    model: a.model,
    apiKey: a.apiKey || undefined,
    baseUrl: a.baseUrl || undefined,
    role: a.role,
    personality: a.personality || undefined,
    groupPersonality: groupPersonalities[a.role]?.trim() || undefined,
    webSearch: a.webSearch === true,
    followLinks: a.followLinks === true,
    team: a.team ?? 1,
  };
}

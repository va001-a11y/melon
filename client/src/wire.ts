import { MAX_SEARCH_ITEMS } from "@melon/core";
import type { AgentSpec } from "@melon/core";
import type { Agent, Settings } from "./types";

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

/**
 * Settings as a run request carries them.
 *
 * Exactly one search key goes out: the selected engine's. The map holds a key
 * for every engine the user has set up, and none of the others has any
 * business leaving the page -- not to Melon's server, and certainly not to a
 * different search company.
 *
 * "Automatic" items is sent as the most there is; the room in the smallest
 * model still decides how many actually fit (core searchBudget).
 */
export function toRunSettings<T extends Settings>(settings: T) {
  const { searchApiKeys, ...rest } = settings;
  return {
    ...rest,
    searchApiKey: searchApiKeys?.[settings.searchProvider] ?? "",
    searchItems: settings.searchItemsAuto === false ? settings.searchItems : MAX_SEARCH_ITEMS,
  };
}

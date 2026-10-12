import { sanitiseBaseUrl } from "./secrets";

/*
 * Backup and restore for everything Melon keeps.
 *
 * Melon stores nothing in its own folder: chats, agents, settings and API
 * keys all live in the browser's localStorage, scoped to the origin. That is
 * why deleting the Melon directory loses nothing and why a fresh copy on the
 * same port finds the old data waiting. It is also why there was no way to
 * move a chat history between machines, and why clearing browser data would
 * destroy the lot with nothing to restore from.
 *
 * Everything is keyed under one prefix, so a backup is simply every key
 * carrying it. Collecting them generically rather than naming them means a
 * key added later is included without anyone remembering to come back here.
 */
const PREFIX = "melon.";
const CHAT_PREFIX = "melon.chat.";
const AGENTS_KEY = "melon.agents";

export const BACKUP_FORMAT = 1;

export interface Backup {
  /** Spelled in capitals, and placed first, so a text editor shows it immediately. */
  WARNING?: string;
  melonBackup: number;
  exportedAt: string;
  containsApiKeys: boolean;
  data: Record<string, string>;
}

export const KEY_WARNING =
  "THIS FILE CONTAINS YOUR API KEYS IN PLAIN TEXT. Anyone who opens it can spend " +
  "money on your accounts. Do not email it, upload it, attach it to a bug report, " +
  "put it in a shared folder, or commit it to a repository. Delete it once you " +
  "have restored from it.";

interface StoredAgent {
  apiKey?: string;
  baseUrl?: string;
  [k: string]: unknown;
}

function parseAgents(raw: string | undefined): StoredAgent[] | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? (v as StoredAgent[]) : null;
  } catch {
    return null;
  }
}

/**
 * Remove every secret, not merely the obvious field. A base URL can carry a
 * key of its own in a query parameter or as `user:pass@`, which is the same
 * reasoning the preset export already applies.
 */
function withoutSecrets(raw: string): string {
  const agents = parseAgents(raw);
  if (!agents) return raw;
  return JSON.stringify(
    agents.map((a) => {
      const { apiKey: _dropped, ...rest } = a;
      return typeof a.baseUrl === "string" ? { ...rest, baseUrl: sanitiseBaseUrl(a.baseUrl) } : rest;
    })
  );
}

/** Whether any agent actually carries a key — read from the data, never claimed. */
function holdsKeys(raw: string | undefined): boolean {
  const agents = parseAgents(raw);
  if (!agents) return false;
  return agents.some((a) => typeof a.apiKey === "string" && a.apiKey.trim() !== "");
}

export function collectBackup(includeKeys: boolean, store: Storage = localStorage): Backup {
  const data: Record<string, string> = {};
  for (let i = 0; i < store.length; i++) {
    const key = store.key(i);
    if (!key || !key.startsWith(PREFIX)) continue;
    const value = store.getItem(key);
    if (value !== null) data[key] = value;
  }

  if (!includeKeys && data[AGENTS_KEY]) data[AGENTS_KEY] = withoutSecrets(data[AGENTS_KEY]);

  const containsApiKeys = includeKeys && holdsKeys(data[AGENTS_KEY]);
  const body = {
    melonBackup: BACKUP_FORMAT,
    exportedAt: new Date().toISOString(),
    containsApiKeys,
    data,
  };
  // Key order is insertion order, so this really does land at the top.
  return containsApiKeys ? { WARNING: KEY_WARNING, ...body } : body;
}

export interface BackupSummary {
  ok: boolean;
  problem?: string;
  exportedAt?: string;
  chats: number;
  agents: number;
  /** Determined by inspecting the agents, so a hand-edited header cannot lie. */
  containsApiKeys: boolean;
  backup?: Backup;
}

export function describeBackup(text: string): BackupSummary {
  const empty = { ok: false, chats: 0, agents: 0, containsApiKeys: false };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ...empty, problem: "That file is not valid JSON." };
  }
  const b = parsed as Partial<Backup>;
  if (!b || typeof b !== "object" || typeof b.melonBackup !== "number" || !b.data) {
    return { ...empty, problem: "That does not look like a Melon backup." };
  }
  if (b.melonBackup > BACKUP_FORMAT) {
    return { ...empty, problem: "That backup was made by a newer version of Melon." };
  }
  const data = b.data as Record<string, string>;
  const agents = parseAgents(data[AGENTS_KEY]);
  return {
    ok: true,
    exportedAt: typeof b.exportedAt === "string" ? b.exportedAt : undefined,
    chats: Object.keys(data).filter((k) => k.startsWith(CHAT_PREFIX)).length,
    agents: agents?.length ?? 0,
    containsApiKeys: holdsKeys(data[AGENTS_KEY]),
    backup: { ...(b as Backup), data },
  };
}

/**
 * Replace rather than merge. A restore that half-applied — new agents beside
 * old ones, chats from two machines interleaved — would be worse than either
 * state, and impossible to reason about afterwards.
 */
export function applyBackup(backup: Backup, store: Storage = localStorage): void {
  const existing: string[] = [];
  for (let i = 0; i < store.length; i++) {
    const key = store.key(i);
    if (key && key.startsWith(PREFIX)) existing.push(key);
  }
  for (const key of existing) store.removeItem(key);
  for (const [key, value] of Object.entries(backup.data)) {
    if (key.startsWith(PREFIX) && typeof value === "string") store.setItem(key, value);
  }
}

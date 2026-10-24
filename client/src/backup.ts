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
const SETTINGS_KEY = "melon.settings";

/**
 * Secrets that live in settings rather than on an agent. The search engine's
 * key is one, and keyless export used to miss it entirely: it stripped every
 * agent's key and then wrote the search key into the file anyway, in a file
 * the README described as safe to attach to a bug report.
 */
const SETTINGS_SECRET_FIELDS = ["searchApiKey", "searchApiKeys"];

/**
 * What a backup covers. Exporting everything is the right default for a
 * safety copy, but the two halves move for different reasons: a line-up of
 * agents is worth sharing or carrying to another machine on its own, and a
 * chat history is worth keeping without dragging keys along with it.
 */
export type BackupScope = "everything" | "agents" | "chats";

/** Named keys belonging to the conversation history, beyond `melon.chat.*`. */
const CHAT_KEYS = ["melon.chats.index", "melon.currentChat"];

/** The line-up: agents plus everything that describes how they are arranged. */
const AGENT_KEYS = ["melon.agents", "melon.presets", "melon.teamNames", "melon.teamBriefs", "melon.groupPersonalities"];

/** Whether a stored key belongs to a scope. */
export function inScope(key: string, scope: BackupScope): boolean {
  if (!key.startsWith(PREFIX)) return false;
  if (scope === "everything") return true;
  if (scope === "chats") return key.startsWith(CHAT_PREFIX) || CHAT_KEYS.includes(key);
  return AGENT_KEYS.includes(key);
}

export const BACKUP_FORMAT = 1;

export interface Backup {
  /** Spelled in capitals, and placed first, so a text editor shows it immediately. */
  WARNING?: string;
  melonBackup: number;
  exportedAt: string;
  /** Absent in files written before scopes existed; those held everything. */
  scope?: BackupScope;
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

function parseSettings(raw: string | undefined): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Settings with every secret field removed outright, not blanked. */
function settingsWithoutSecrets(raw: string): string {
  const settings = parseSettings(raw);
  if (!settings) return raw;
  const kept = { ...settings };
  for (const field of SETTINGS_SECRET_FIELDS) delete kept[field];
  return JSON.stringify(kept);
}

/** Whether settings hold any search key, in the old single field or the per-engine map. */
function settingsHoldKeys(raw: string | undefined): boolean {
  const settings = parseSettings(raw);
  if (!settings) return false;
  const single = settings.searchApiKey;
  if (typeof single === "string" && single.trim() !== "") return true;
  const many = settings.searchApiKeys;
  if (many && typeof many === "object") {
    return Object.values(many as Record<string, unknown>).some((v) => typeof v === "string" && v.trim() !== "");
  }
  return false;
}

/** Whether any agent actually carries a key — read from the data, never claimed. */
function holdsKeys(raw: string | undefined): boolean {
  const agents = parseAgents(raw);
  if (!agents) return false;
  return agents.some((a) => typeof a.apiKey === "string" && a.apiKey.trim() !== "");
}

export function collectBackup(
  scope: BackupScope,
  includeKeys: boolean,
  store: Storage = localStorage
): Backup {
  const data: Record<string, string> = {};
  for (let i = 0; i < store.length; i++) {
    const key = store.key(i);
    if (!key || !inScope(key, scope)) continue;
    const value = store.getItem(key);
    if (value !== null) data[key] = value;
  }

  if (!includeKeys && data[AGENTS_KEY]) data[AGENTS_KEY] = withoutSecrets(data[AGENTS_KEY]);
  if (!includeKeys && data[SETTINGS_KEY]) data[SETTINGS_KEY] = settingsWithoutSecrets(data[SETTINGS_KEY]);

  const containsApiKeys = includeKeys && (holdsKeys(data[AGENTS_KEY]) || settingsHoldKeys(data[SETTINGS_KEY]));
  const body = {
    melonBackup: BACKUP_FORMAT,
    exportedAt: new Date().toISOString(),
    scope,
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
  /** What this file will replace. Legacy files without one held everything. */
  scope: BackupScope;
  chats: number;
  agents: number;
  /** Determined by inspecting the agents, so a hand-edited header cannot lie. */
  containsApiKeys: boolean;
  backup?: Backup;
}

export function describeBackup(text: string): BackupSummary {
  const empty = { ok: false, scope: "everything" as BackupScope, chats: 0, agents: 0, containsApiKeys: false };
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
  // A file written before scopes existed carried everything, so that is the
  // only safe reading of a missing field, and the only one that restores such
  // a file the way it was written.
  const scope: BackupScope =
    b.scope === "agents" || b.scope === "chats" ? b.scope : "everything";
  return {
    ok: true,
    scope,
    exportedAt: typeof b.exportedAt === "string" ? b.exportedAt : undefined,
    chats: Object.keys(data).filter((k) => k.startsWith(CHAT_PREFIX)).length,
    agents: agents?.length ?? 0,
    containsApiKeys: holdsKeys(data[AGENTS_KEY]) || settingsHoldKeys(data[SETTINGS_KEY]),
    backup: { ...(b as Backup), data },
  };
}

/**
 * Replace rather than merge. A restore that half-applied — new agents beside
 * old ones, chats from two machines interleaved — would be worse than either
 * state, and impossible to reason about afterwards.
 *
 * Confining the replacement to the file's own scope is equally deliberate,
 * and is what makes a partial export safe to accept: restoring a chats-only
 * file must not delete the agents it never contained, which is precisely
 * what a blanket wipe would have done.
 *
 * All or nothing. The old data is removed before the new is written, so a
 * write that fails partway — browser storage full, most likely — would leave
 * neither: the current chats gone and the backup half-applied. What was
 * there is held in memory first and put back if any write fails, and the
 * error is rethrown for the caller to report.
 */
export function applyBackup(backup: Backup, store: Storage = localStorage): void {
  const scope: BackupScope =
    backup.scope === "agents" || backup.scope === "chats" ? backup.scope : "everything";

  const previous = new Map<string, string>();
  for (let i = 0; i < store.length; i++) {
    const key = store.key(i);
    if (key && inScope(key, scope)) previous.set(key, store.getItem(key) ?? "");
  }
  for (const key of previous.keys()) store.removeItem(key);
  const written: string[] = [];
  try {
    for (const [key, value] of Object.entries(backup.data)) {
      if (inScope(key, scope) && typeof value === "string") {
        store.setItem(key, value);
        written.push(key);
      }
    }
  } catch (error) {
    for (const key of written) store.removeItem(key);
    // This fitted before, and the half-written backup is gone again, so it fits now.
    for (const [key, value] of previous) store.setItem(key, value);
    throw error;
  }
}

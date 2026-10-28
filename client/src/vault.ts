/*
 * The passphrase lock for API keys.
 *
 * Without it, keys sit in localStorage as plain text: readable by anyone at
 * the computer, by anything that copies the browser's profile off the disk,
 * and — on the hosted build — by any other page published to the same
 * origin (see the README's "Where your keys actually live"). Encrypting them
 * is only worth doing if the thing that decrypts them is not stored beside
 * them, so the key is derived from a passphrase the person types each time
 * Melon opens, and lives only in memory after that.
 *
 * When the lock is on, the keys are removed from the stored agents and
 * settings and kept in one encrypted record instead. That record is also the
 * preference itself: while it exists, Melon asks for the passphrase before it
 * starts, on every launch, until the lock is turned off in Settings.
 *
 * What this does not protect against is anything running inside Melon's
 * page while it is unlocked — at that point the keys are in use, and the page
 * can read them. That is true of any lock that lets the app use the keys.
 *
 * Browsers only offer Web Crypto on HTTPS and on localhost, so the lock is
 * unavailable on a plain-HTTP LAN address — which is also where the README
 * says to use a VPN or an HTTPS proxy instead.
 */

export const VAULT_KEY = "melon.vault";
const AGENTS_KEY = "melon.agents";
const SETTINGS_KEY = "melon.settings";

/**
 * PBKDF2-SHA256 at OWASP's current recommendation. About half a second on a
 * laptop, a second or two on a phone — paid once per unlock, and it is what
 * makes guessing a passphrase from a stolen record slow.
 */
const ITERATIONS = 600_000;

/** Short passphrases fall quickly to guessing once the record is copied. */
export const MIN_PASSPHRASE = 8;

export interface VaultRecord {
  melonVault: 1;
  iterations: number;
  salt: string;
  iv: string;
  data: string;
}

/** Every key Melon holds: one per agent, by agent id, and one per search engine. */
export interface Secrets {
  agents: Record<string, string>;
  search: Record<string, string>;
}

/** Web Crypto accepts only bytes backed by an ordinary ArrayBuffer. */
type Bytes = Uint8Array<ArrayBuffer>;

interface Session {
  key: CryptoKey;
  salt: Bytes;
  iterations: number;
}

export class WrongPassphrase extends Error {
  constructor() {
    super("That passphrase does not unlock these keys.");
  }
}

let session: Session | null = null;
/** The keys as last unlocked or sealed, for the first render and for backups. */
let live: Secrets | null = null;

export function vaultSupported(): boolean {
  const g = globalThis as { isSecureContext?: boolean; crypto?: Crypto };
  return Boolean(g.crypto?.subtle) && g.isSecureContext !== false;
}

/** Whether keys are locked and this session holds the passphrase. */
export function vaultOpen(): boolean {
  return session !== null;
}

export function liveSecrets(): Secrets | null {
  return live;
}

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromBase64(text: string): Bytes {
  return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
}

export function readVault(store: Storage = localStorage): VaultRecord | null {
  try {
    const raw = store.getItem(VAULT_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<VaultRecord>;
    if (
      v?.melonVault !== 1 ||
      typeof v.iterations !== "number" ||
      typeof v.salt !== "string" ||
      typeof v.iv !== "string" ||
      typeof v.data !== "string"
    ) {
      return null;
    }
    return v as VaultRecord;
  } catch {
    return null;
  }
}

async function deriveKey(passphrase: string, salt: Bytes, iterations: number): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    "raw",
    // Normalised, so the same passphrase typed on a different keyboard or OS still matches.
    new TextEncoder().encode(passphrase.normalize("NFC")),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    material,
    { name: "AES-GCM", length: 256 },
    // Not extractable: even code in this page cannot read the key back out.
    false,
    ["encrypt", "decrypt"]
  );
}

/**
 * A session for a new passphrase, not yet in use. Turning the lock on and
 * changing the passphrase both seal with it first and adopt it only once
 * the new record is safely stored, so a failed save leaves the old lock
 * exactly as it was.
 */
export async function newSession(passphrase: string): Promise<Session> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { key: await deriveKey(passphrase, salt, ITERATIONS), salt, iterations: ITERATIONS };
}

export function adoptSession(s: Session): void {
  session = s;
}

/** Forget the passphrase and the keys: the lock is off, or the app is closing. */
export function endSession(): void {
  session = null;
  live = null;
}

/** Decrypts the record, and on success keeps the session for re-sealing. */
export async function unlock(passphrase: string, record: VaultRecord): Promise<Secrets> {
  const salt = fromBase64(record.salt);
  const key = await deriveKey(passphrase, salt, record.iterations);
  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(record.iv) }, key, fromBase64(record.data));
  } catch {
    // AES-GCM authenticates as well as decrypts, so a wrong passphrase fails
    // here rather than producing garbage that looks like keys.
    throw new WrongPassphrase();
  }
  const secrets = normaliseSecrets(JSON.parse(new TextDecoder().decode(plain)));
  session = { key, salt, iterations: record.iterations };
  live = secrets;
  return secrets;
}

/** Encrypts the keys with a fresh IV. Uses the current session unless given another. */
export async function seal(secrets: Secrets, using: Session | null = session): Promise<VaultRecord> {
  if (!using) throw new Error("The keys are not locked, so there is nothing to seal them with.");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    using.key,
    new TextEncoder().encode(JSON.stringify(secrets))
  );
  live = secrets;
  return {
    melonVault: 1,
    iterations: using.iterations,
    salt: toBase64(using.salt),
    iv: toBase64(iv),
    data: toBase64(new Uint8Array(data)),
  };
}

function stringRecord(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof v === "string" && v.trim() !== "") out[k] = v;
    }
  }
  return out;
}

function normaliseSecrets(raw: unknown): Secrets {
  const r = (raw ?? {}) as { agents?: unknown; search?: unknown };
  return { agents: stringRecord(r.agents), search: stringRecord(r.search) };
}

interface Keyed {
  id: string;
  apiKey?: string;
}

/** The keys held by these agents and settings, empty ones left out. */
export function secretsOf(agents: Keyed[], searchApiKeys: Record<string, string> | undefined): Secrets {
  const byAgent: Record<string, string> = {};
  for (const a of agents) if (a.apiKey && a.apiKey.trim() !== "") byAgent[a.id] = a.apiKey;
  return { agents: byAgent, search: stringRecord(searchApiKeys) };
}

export function withoutAgentKeys<T extends Keyed>(agents: T[]): T[] {
  return agents.map((a) => ({ ...a, apiKey: "" }));
}

/**
 * Puts unlocked keys back on the agents. A key already stored in plain text
 * wins: one is there only when it was written after the record — a restore,
 * or a save interrupted between its two writes — so it is the newer of the two.
 */
export function withAgentKeys<T extends Keyed>(agents: T[], secrets: Secrets | null): T[] {
  if (!secrets) return agents;
  return agents.map((a) => (a.apiKey ? a : { ...a, apiKey: secrets.agents[a.id] ?? "" }));
}

export function withSearchKeys(stored: Record<string, string>, secrets: Secrets | null): Record<string, string> {
  return secrets ? { ...secrets.search, ...stringRecord(stored) } : stored;
}

/**
 * After a restore, while locked: whatever keys the backup brought are in
 * plain text in storage. Seal them and strip them, so restoring a backup
 * never quietly turns the lock off. If this fails, the plain keys are still
 * there, and the next unlock adopts and seals them (see withAgentKeys).
 */
export async function resealStored(store: Storage = localStorage): Promise<void> {
  if (!session) return;
  let agents: Keyed[] = [];
  let settings: Record<string, unknown> = {};
  try {
    const a = JSON.parse(store.getItem(AGENTS_KEY) ?? "[]");
    if (Array.isArray(a)) agents = a.filter((x) => x && typeof x.id === "string");
    const s = JSON.parse(store.getItem(SETTINGS_KEY) ?? "{}");
    if (s && typeof s === "object" && !Array.isArray(s)) settings = s;
  } catch {
    return;
  }
  // A backup from before one-key-per-engine carries its search key in the old
  // single field, which App only migrates on load. Fold it in here too, or it
  // would stay behind in plain text.
  const search = stringRecord(settings.searchApiKeys);
  const legacy = settings.searchApiKey;
  const provider = settings.searchProvider;
  if (typeof legacy === "string" && legacy.trim() && typeof provider === "string" && provider && !search[provider]) {
    search[provider] = legacy;
  }
  const record = await seal({ agents: secretsOf(agents, {}).agents, search });
  store.setItem(VAULT_KEY, JSON.stringify(record));
  const rawAgents = JSON.parse(store.getItem(AGENTS_KEY) ?? "[]");
  if (Array.isArray(rawAgents)) store.setItem(AGENTS_KEY, JSON.stringify(withoutAgentKeys(rawAgents)));
  if (store.getItem(SETTINGS_KEY) !== null) {
    const { searchApiKey: _legacy, ...rest } = settings;
    store.setItem(SETTINGS_KEY, JSON.stringify({ ...rest, searchApiKeys: {} }));
  }
}

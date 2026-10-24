/**
 * Where conversations are kept.
 *
 * Chats used to live in localStorage beside everything else, and localStorage
 * holds about five million characters per site. Images are saved inside chats
 * as base64, so two phone photos filled it. IndexedDB is the browser's store
 * for exactly this — its allowance is a share of the disk, typically hundreds
 * of megabytes or more — so chats live there now.
 *
 * Only chats moved. Settings, agents, keys and the chat list are small, are
 * read synchronously all over the app, and stay in localStorage. Each chat is
 * stored as the same JSON string it always was, keyed by its id, so a backup
 * file reads and writes `melon.chat.<id>` exactly as before and files move
 * freely between this version and older ones.
 *
 * Should IndexedDB be unavailable — some privacy settings block it — chats
 * fall back to localStorage, where they were, and the full-storage handling
 * built for that case still applies.
 */

export const CHAT_KEY_PREFIX = "melon.chat.";

export interface ChatStore {
  readonly kind: "indexeddb" | "localstorage";
  get(id: string): Promise<string | null>;
  put(id: string, json: string): Promise<void>;
  remove(id: string): Promise<void>;
  /** Every chat, by id. */
  all(): Promise<Record<string, string>>;
  /** Replace every chat in one step: all of them land, or nothing changes. */
  replaceAll(chats: Record<string, string>): Promise<void>;
}

// ---------------------------------------------------------------- IndexedDB

const DB_NAME = "melon";
const DB_VERSION = 1;
const STORE = "chats";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => {
      const db = req.result;
      // A newer Melon in another tab wants to upgrade; get out of its way.
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("IndexedDB is blocked by another tab"));
  });
}

/**
 * Run work in one transaction and settle when it has committed, not merely
 * when a request succeeded: a write is only safe once the transaction is
 * complete, and a quota failure arrives as the transaction aborting.
 */
function inTransaction<T>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T> | void
): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = work(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req ? req.result : (undefined as T));
    tx.onerror = () => reject(tx.error ?? req?.error);
    tx.onabort = () => reject(tx.error ?? new DOMException("Transaction aborted", "AbortError"));
  });
}

function indexedDbStore(db: IDBDatabase): ChatStore {
  return {
    kind: "indexeddb",
    async get(id) {
      const value = await inTransaction<unknown>(db, "readonly", (s) => s.get(id));
      return typeof value === "string" ? value : null;
    },
    async put(id, json) {
      await inTransaction(db, "readwrite", (s) => s.put(json, id));
    },
    async remove(id) {
      await inTransaction(db, "readwrite", (s) => s.delete(id));
    },
    async all() {
      const out: Record<string, string> = {};
      await inTransaction(db, "readonly", (s) => {
        const cursor = s.openCursor();
        cursor.onsuccess = () => {
          const c = cursor.result;
          if (!c) return;
          if (typeof c.value === "string") out[String(c.key)] = c.value;
          c.continue();
        };
      });
      return out;
    },
    async replaceAll(chats) {
      // One transaction: if any write fails, the clear is rolled back with it.
      await inTransaction(db, "readwrite", (s) => {
        s.clear();
        for (const [id, json] of Object.entries(chats)) s.put(json, id);
      });
    },
  };
}

// ------------------------------------------------------------- localStorage

/** The old home, kept as the fallback. Reads `localStorage` at call time. */
export const localStorageChats: ChatStore = {
  kind: "localstorage",
  async get(id) {
    return localStorage.getItem(CHAT_KEY_PREFIX + id);
  },
  async put(id, json) {
    localStorage.setItem(CHAT_KEY_PREFIX + id, json);
  },
  async remove(id) {
    localStorage.removeItem(CHAT_KEY_PREFIX + id);
  },
  async all() {
    const out: Record<string, string> = {};
    for (const key of Object.keys(localStorage)) {
      if (!key.startsWith(CHAT_KEY_PREFIX)) continue;
      const value = localStorage.getItem(key);
      if (value !== null) out[key.slice(CHAT_KEY_PREFIX.length)] = value;
    }
    return out;
  },
  async replaceAll(chats) {
    const previous = await this.all();
    for (const id of Object.keys(previous)) localStorage.removeItem(CHAT_KEY_PREFIX + id);
    const written: string[] = [];
    try {
      for (const [id, json] of Object.entries(chats)) {
        localStorage.setItem(CHAT_KEY_PREFIX + id, json);
        written.push(id);
      }
    } catch (error) {
      for (const id of written) localStorage.removeItem(CHAT_KEY_PREFIX + id);
      for (const [id, json] of Object.entries(previous)) localStorage.setItem(CHAT_KEY_PREFIX + id, json);
      throw error;
    }
  },
};

// ------------------------------------------------------------------ startup

let current: ChatStore = localStorageChats;
const preloaded = new Map<string, string | null>();

export function getChatStore(): ChatStore {
  return current;
}

/**
 * The chat read during startup, so the first render can show it without
 * waiting. Not removed once read: StrictMode runs state initialisers twice in
 * development, and the second run must see the same chat as the first.
 */
export function preloadedChat(id: string): string | null {
  return preloaded.get(id) ?? null;
}

/**
 * Chats saved by an older Melon are in localStorage. Copy them across in one
 * transaction, and only once that has committed remove the originals — so an
 * interrupted move leaves them where they were, to be moved next time. A chat
 * already present in IndexedDB is left as it is.
 */
async function moveFromLocalStorage(store: ChatStore): Promise<void> {
  const legacy = await localStorageChats.all();
  const ids = Object.keys(legacy);
  if (ids.length === 0) return;
  const existing = await store.all();
  const merged = { ...existing };
  for (const id of ids) if (!(id in merged)) merged[id] = legacy[id];
  await store.replaceAll(merged);
  for (const id of ids) localStorage.removeItem(CHAT_KEY_PREFIX + id);
}

/**
 * Choose where chats live and move any old ones there. Never throws: any
 * failure leaves chats in localStorage, exactly where an older Melon put them.
 */
export async function initChatStore(currentChatId: string): Promise<void> {
  try {
    if (typeof indexedDB === "undefined") throw new Error("IndexedDB is not available");
    const store = indexedDbStore(await openDb());
    await moveFromLocalStorage(store);
    current = store;
  } catch (error) {
    console.warn("Melon is keeping chats in localStorage:", error);
    current = localStorageChats;
  }
  if (currentChatId) {
    try {
      preloaded.set(currentChatId, await current.get(currentChatId));
    } catch {
      preloaded.set(currentChatId, null);
    }
  }
}

/**
 * Stand-ins for the browser, so client code that keeps data in the browser
 * can be tested in Node.
 */
import type { ChatStore } from "../client/src/chatStore.ts";

/**
 * localStorage with a size limit, throwing the same error a browser throws
 * when it is full. Without the limit, the bugs this suite exists to catch —
 * a save or a restore failing partway — cannot happen in a test at all.
 */
export class MemoryStorage {
  map = new Map<string, string>();
  constructor(
    initial: Record<string, string> = {},
    public cap = Infinity
  ) {
    for (const [k, v] of Object.entries(initial)) this.map.set(k, v);
  }
  get length() {
    return this.map.size;
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null;
  }
  getItem(k: string) {
    return this.map.has(k) ? this.map.get(k)! : null;
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
  clear() {
    this.map.clear();
  }
  private used() {
    let n = 0;
    for (const [k, v] of this.map) n += k.length + v.length;
    return n;
  }
  setItem(k: string, v: string) {
    const before = this.map.get(k);
    const after = this.used() - (before === undefined ? 0 : k.length + before.length) + k.length + v.length;
    if (after > this.cap) throw new DOMException("Setting the value exceeded the quota.", "QuotaExceededError");
    this.map.set(k, String(v));
  }
  /** Everything stored, sorted, for comparing before and after. */
  snapshot() {
    return JSON.stringify([...this.map].sort());
  }
  asStorage() {
    return this as unknown as Storage;
  }
  /**
   * Installed as the global `localStorage`. A proxy, because code reads
   * `Object.keys(localStorage)`, which only sees real own properties.
   */
  installGlobally() {
    const store = this;
    (globalThis as { localStorage?: unknown }).localStorage = new Proxy(this, {
      ownKeys: () => [...store.map.keys()],
      getOwnPropertyDescriptor: (_t, k) =>
        typeof k === "string" && store.map.has(k)
          ? { enumerable: true, configurable: true, value: store.map.get(k) }
          : undefined,
    });
  }
}

/**
 * A chat store in memory, with IndexedDB's all-or-nothing replaceAll and a
 * switch to make the next one fail like a full disk.
 */
export class MemoryChats implements ChatStore {
  readonly kind = "indexeddb" as const;
  map = new Map<string, string>();
  failNextReplace = false;
  constructor(initial: Record<string, string> = {}) {
    for (const [k, v] of Object.entries(initial)) this.map.set(k, v);
  }
  async get(id: string) {
    return this.map.get(id) ?? null;
  }
  async put(id: string, json: string) {
    this.map.set(id, json);
  }
  async remove(id: string) {
    this.map.delete(id);
  }
  async all() {
    return Object.fromEntries(this.map);
  }
  async replaceAll(chats: Record<string, string>) {
    if (this.failNextReplace) {
      this.failNextReplace = false;
      throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
    }
    this.map = new Map(Object.entries(chats));
  }
  snapshot() {
    return JSON.stringify([...this.map].sort());
  }
}

/**
 * Where chats live, and what happens when there is no room. Before v0.7.1,
 * two phone photos filled localStorage and crashed Melon, losing the reply.
 *
 * Node has no IndexedDB, so these cover the localStorage fallback and the
 * startup decision; the IndexedDB path itself is exercised in the browser.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { getChatStore, initChatStore, localStorageChats, preloadedChat } from "../client/src/chatStore.ts";
import { isQuotaError, trySave } from "../client/src/storage.ts";
import { MemoryStorage } from "./helpers.ts";

test("the fallback store keeps chats under melon.chat.<id>, as older versions did", async () => {
  const ls = new MemoryStorage();
  ls.installGlobally();
  await localStorageChats.put("x", "one");
  assert.equal(ls.getItem("melon.chat.x"), "one");
  assert.deepEqual(await localStorageChats.all(), { x: "one" });
});

test("a fallback replaceAll that runs out of room puts the old chats back", async () => {
  const ls = new MemoryStorage({}, 2000);
  ls.installGlobally();
  await localStorageChats.put("x", "one");
  await localStorageChats.put("y", "two");
  await assert.rejects(localStorageChats.replaceAll({ a: "q".repeat(5000) }), (e) => isQuotaError(e));
  assert.equal(ls.getItem("melon.chat.x"), "one");
  assert.equal(ls.getItem("melon.chat.y"), "two");
  assert.equal(ls.getItem("melon.chat.a"), null);
});

test("without IndexedDB, startup keeps chats where they are and preloads the open one", async () => {
  const ls = new MemoryStorage({ "melon.chat.cur": '[{"kind":"user","text":"hi"}]' });
  ls.installGlobally();
  assert.equal(typeof (globalThis as { indexedDB?: unknown }).indexedDB, "undefined", "precondition");
  const warn = console.warn;
  console.warn = () => {}; // the fallback announces itself; expected here
  try {
    await initChatStore("cur");
  } finally {
    console.warn = warn;
  }
  assert.equal(getChatStore().kind, "localstorage");
  assert.notEqual(ls.getItem("melon.chat.cur"), null, "nothing was moved or lost");
  assert.equal(preloadedChat("cur"), '[{"kind":"user","text":"hi"}]');
  // React's StrictMode runs state initialisers twice; the second read must match.
  assert.equal(preloadedChat("cur"), '[{"kind":"user","text":"hi"}]');
});

test("isQuotaError knows a full store from other failures", () => {
  assert.ok(isQuotaError(new DOMException("x", "QuotaExceededError")));
  assert.ok(isQuotaError(new DOMException("x", "NS_ERROR_DOM_QUOTA_REACHED")), "older Firefox");
  assert.ok(!isQuotaError(new Error("boom")));
  assert.ok(!isQuotaError(new DOMException("x", "SecurityError")));
});

test("trySave reports a full store instead of throwing", () => {
  new MemoryStorage({}, 20).installGlobally();
  assert.equal(trySave("k", "short"), true);
  assert.equal(trySave("k", "far too long for the space left"), false);
});

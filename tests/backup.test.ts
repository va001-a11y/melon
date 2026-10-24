/**
 * Backup and restore. Every test here is a bug that shipped:
 *
 * - v0.6.0–v0.6.3: "Export without API keys" exported the web search key.
 * - v0.6.2 (caught before release): a chats-only restore deleted the agents.
 * - before v0.7.1: a restore that ran out of room deleted your data.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { applyBackup, collectBackup, describeBackup } from "../client/src/backup.ts";
import { isQuotaError } from "../client/src/storage.ts";
import { MemoryChats, MemoryStorage } from "./helpers.ts";

function seeded(cap = Infinity) {
  const store = new MemoryStorage(
    {
      "melon.agents": JSON.stringify([
        { id: "a", name: "Mine", apiKey: "sk-AGENT", baseUrl: "https://x.test/v1?key=URLKEY" },
      ]),
      "melon.teamNames": JSON.stringify({ 1: "Research" }),
      "melon.chats.index": JSON.stringify([{ id: "c1", title: "my old chat" }]),
      "melon.settings": JSON.stringify({
        mode: "professional",
        searchProvider: "serper",
        searchApiKeys: { serper: "SERPER-KEY", linkup: "LINKUP-KEY" },
      }),
      "other.app": "not ours",
    },
    cap
  );
  const chats = new MemoryChats({ c1: JSON.stringify([{ kind: "user", text: "my old chat" }]) });
  return { store, chats };
}

const collect = async (scope: "everything" | "agents" | "chats", withKeys: boolean, s = seeded()) =>
  collectBackup(scope, withKeys, s.store.asStorage(), s.chats);

test("a keyless export holds no agent key, no key hidden in a base URL, and no search key", async () => {
  const file = JSON.stringify(await collect("everything", false));
  assert.ok(!file.includes("sk-AGENT"), "agent key");
  assert.ok(!file.includes("URLKEY"), "key in a base URL");
  assert.ok(!file.includes("SERPER-KEY") && !file.includes("LINKUP-KEY"), "search keys");
  assert.ok(file.includes("professional"), "the rest of the settings is kept");
});

test("the old single search-key field is stripped too", async () => {
  const s = seeded();
  s.store.setItem("melon.settings", JSON.stringify({ searchProvider: "tavily", searchApiKey: "tvly-OLD" }));
  const file = JSON.stringify(await collect("everything", false, s));
  assert.ok(!file.includes("tvly-OLD"));
});

test("an export with keys keeps them, warns, and a search key alone counts as a key", async () => {
  const s = seeded();
  s.store.setItem("melon.agents", "[]");
  const backup = await collect("everything", true, s);
  assert.ok(JSON.stringify(backup).includes("SERPER-KEY"));
  assert.equal(backup.containsApiKeys, true);
  assert.ok(backup.WARNING);
  assert.equal(describeBackup(JSON.stringify(backup)).containsApiKeys, true);
});

test("a keyless file is described as keyless", async () => {
  const backup = await collect("everything", false);
  assert.equal(describeBackup(JSON.stringify(backup)).containsApiKeys, false);
});

test("chats are exported from the chat store, under the keys older versions use", async () => {
  const s = seeded();
  s.store.setItem("melon.chat.stray", "left in localStorage by mistake");
  const backup = await collect("everything", true, s);
  assert.equal(backup.data["melon.chat.c1"], s.chats.map.get("c1"));
  assert.ok(!("melon.chat.stray" in backup.data), "chats never come from localStorage");
});

test("each scope takes only its own half, and never another app's data", async () => {
  const agents = await collect("agents", true);
  assert.ok(!Object.keys(agents.data).some((k) => k.startsWith("melon.chat")));
  const chats = await collect("chats", true);
  assert.ok(Object.keys(chats.data).every((k) => k.startsWith("melon.chat") || k === "melon.chats.index"));
  const everything = await collect("everything", true);
  assert.ok(!("other.app" in everything.data));
});

const incoming = {
  melonBackup: 1,
  exportedAt: "2026-10-24T00:00:00Z",
  scope: "everything" as const,
  containsApiKeys: false,
  data: {
    "melon.agents": JSON.stringify([{ id: "b", name: "Theirs" }]),
    "melon.chat.new1": JSON.stringify([{ kind: "user", text: "y".repeat(5000) }]),
    "melon.chat.new2": JSON.stringify([{ kind: "user", text: "y".repeat(5000) }]),
    "melon.chats.index": JSON.stringify([{ id: "new1" }, { id: "new2" }]),
  },
};

test("a restore that fits replaces agents and chats, and puts no chats in localStorage", async () => {
  const { store, chats } = seeded();
  await applyBackup(incoming, store.asStorage(), chats);
  assert.ok(store.getItem("melon.agents")!.includes("Theirs"));
  assert.deepEqual([...chats.map.keys()].sort(), ["new1", "new2"]);
  assert.ok(![...store.map.keys()].some((k) => k.startsWith("melon.chat.")));
});

test("a chats-only restore leaves the agents, their keys and the search keys alone", async () => {
  const { store, chats } = seeded();
  await applyBackup({ ...incoming, scope: "chats" }, store.asStorage(), chats);
  assert.ok(store.getItem("melon.agents")!.includes("sk-AGENT"));
  assert.ok(store.getItem("melon.settings")!.includes("SERPER-KEY"));
  assert.ok(chats.map.has("new1") && !chats.map.has("c1"));
});

test("an agents-only restore leaves the chats alone", async () => {
  const { store, chats } = seeded();
  await applyBackup({ ...incoming, scope: "agents" }, store.asStorage(), chats);
  assert.ok(chats.map.has("c1") && !chats.map.has("new1"));
});

test("a restore that runs out of room changes nothing", async () => {
  const { store, chats } = seeded(600);
  const before = [store.snapshot(), chats.snapshot()];
  const tooBig = { ...incoming, data: { ...incoming.data, "melon.agents": "z".repeat(2000) } };
  await assert.rejects(applyBackup(tooBig, store.asStorage(), chats), (e) => isQuotaError(e));
  assert.deepEqual([store.snapshot(), chats.snapshot()], before);
  assert.ok(store.getItem("melon.agents")!.includes("sk-AGENT"), "the API key survives");
});

test("if the chats fail to restore, the agents and settings are put back too", async () => {
  const { store, chats } = seeded();
  const before = [store.snapshot(), chats.snapshot()];
  chats.failNextReplace = true;
  await assert.rejects(applyBackup(incoming, store.asStorage(), chats));
  assert.deepEqual([store.snapshot(), chats.snapshot()], before);
});

test("a file from before scopes existed is read as everything; junk is rejected", async () => {
  const legacy: Record<string, unknown> = { ...(await collect("everything", true)) };
  delete legacy.scope;
  assert.equal(describeBackup(JSON.stringify(legacy)).scope, "everything");
  assert.equal(describeBackup("not json").ok, false);
  assert.equal(describeBackup(JSON.stringify({ hello: 1 })).ok, false);
});

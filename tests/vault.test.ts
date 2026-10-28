/**
 * The passphrase lock for API keys. What matters is what reaches storage:
 * no key in plain text while the lock is on, a wrong passphrase refused
 * rather than decrypting to junk, and a backup or restore that can neither
 * leak the lock's record nor quietly turn the lock off.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  VAULT_KEY,
  WrongPassphrase,
  adoptSession,
  endSession,
  liveSecrets,
  newSession,
  readVault,
  resealStored,
  seal,
  secretsOf,
  unlock,
  withAgentKeys,
  withSearchKeys,
  withoutAgentKeys,
} from "../client/src/vault.ts";
import { applyBackup, collectBackup, describeBackup } from "../client/src/backup.ts";
import { MemoryChats, MemoryStorage } from "./helpers.ts";

const AGENT_KEY = "sk-ant-agent-secret-1234";
const SEARCH_KEY = "tvly-search-secret-5678";

const agents = [
  { id: "a1", name: "Claude", apiKey: AGENT_KEY },
  { id: "a2", name: "Local", apiKey: "" },
];
const secrets = secretsOf(agents, { tavily: SEARCH_KEY, brave: "" });

/** Storage as Melon leaves it while locked: keys out of the agents and settings, sealed beside them. */
async function lockedStore(passphrase: string) {
  const s = await newSession(passphrase);
  adoptSession(s);
  return new MemoryStorage({
    "melon.agents": JSON.stringify(withoutAgentKeys(agents)),
    "melon.settings": JSON.stringify({ searchProvider: "tavily", searchApiKeys: {} }),
    [VAULT_KEY]: JSON.stringify(await seal(secrets)),
  });
}

test("only real keys are collected: empty ones are left out", () => {
  assert.deepEqual(secrets, { agents: { a1: AGENT_KEY }, search: { tavily: SEARCH_KEY } });
});

test("the sealed record holds no key in plain text, and the right passphrase opens it", async () => {
  const store = await lockedStore("correct horse battery");
  const raw = store.snapshot();
  assert.ok(!raw.includes(AGENT_KEY) && !raw.includes(SEARCH_KEY), "a key reached storage unencrypted");

  endSession();
  const record = readVault(store.asStorage());
  assert.ok(record);
  assert.deepEqual(await unlock("correct horse battery", record), secrets);
  assert.deepEqual(liveSecrets(), secrets);
});

test("a wrong passphrase is refused, not decrypted into junk", async () => {
  const store = await lockedStore("correct horse battery");
  endSession();
  await assert.rejects(unlock("correct horse battery!", readVault(store.asStorage())!), WrongPassphrase);
  assert.equal(liveSecrets(), null, "a failed unlock left keys in memory");
});

test("each seal uses a fresh IV, so the same keys never encrypt the same way twice", async () => {
  adoptSession(await newSession("correct horse battery"));
  const one = await seal(secrets);
  const two = await seal(secrets);
  assert.notEqual(one.iv, two.iv);
  assert.notEqual(one.data, two.data);
});

test("a damaged or foreign record is treated as no lock at all", () => {
  for (const raw of ["{not json", "{}", '{"melonVault":2}', "null"]) {
    assert.equal(readVault(new MemoryStorage({ [VAULT_KEY]: raw }).asStorage()), null, raw);
  }
});

test("unlocked keys go back on the agents, but a newer plain-text key wins", () => {
  const stored = [
    { id: "a1", apiKey: "" },
    { id: "a2", apiKey: "sk-written-after-the-lock" },
    { id: "a3", apiKey: "" },
  ];
  const back = withAgentKeys(stored, { agents: { a1: "k1", a2: "k2-older" }, search: {} });
  assert.deepEqual(
    back.map((a) => a.apiKey),
    ["k1", "sk-written-after-the-lock", ""]
  );
  assert.deepEqual(withSearchKeys({ brave: "newer" }, { agents: {}, search: { brave: "older", tavily: "t" } }), {
    brave: "newer",
    tavily: "t",
  });
});

test("a keyless backup while locked carries neither keys nor the lock's record", async () => {
  const store = await lockedStore("correct horse battery");
  const backup = await collectBackup("everything", false, store.asStorage(), new MemoryChats(), secrets);
  const text = JSON.stringify(backup);
  assert.equal(backup.containsApiKeys, false);
  assert.ok(!(VAULT_KEY in backup.data), "the lock's record went into a backup");
  assert.ok(!text.includes(AGENT_KEY) && !text.includes(SEARCH_KEY));
});

test("a backup with keys while locked holds the unlocked keys, and still no record", async () => {
  const store = await lockedStore("correct horse battery");
  const backup = await collectBackup("everything", true, store.asStorage(), new MemoryChats(), secrets);
  assert.equal(backup.containsApiKeys, true);
  assert.ok(backup.WARNING, "a file holding keys must carry the warning");
  assert.ok(!(VAULT_KEY in backup.data));
  assert.equal(JSON.parse(backup.data["melon.agents"])[0].apiKey, AGENT_KEY);
  assert.equal(JSON.parse(backup.data["melon.settings"]).searchApiKeys.tavily, SEARCH_KEY);
  // And an agents-only one, which has no settings to put the search key in.
  const agentsOnly = await collectBackup("agents", true, store.asStorage(), new MemoryChats(), secrets);
  assert.equal(JSON.parse(agentsOnly.data["melon.agents"])[0].apiKey, AGENT_KEY);
});

test("restoring while locked leaves the lock on: the backup's keys are sealed, not left in plain text", async () => {
  const store = await lockedStore("correct horse battery");
  const file = JSON.stringify({
    melonBackup: 1,
    scope: "everything",
    containsApiKeys: true,
    data: {
      "melon.agents": JSON.stringify([{ id: "b1", name: "Restored", apiKey: "sk-from-the-backup" }]),
      // A file from before one key per engine: the old single field.
      "melon.settings": JSON.stringify({ searchProvider: "brave", searchApiKey: "brave-from-the-backup" }),
    },
  });
  await applyBackup(describeBackup(file).backup!, store.asStorage(), new MemoryChats());
  assert.ok(store.getItem(VAULT_KEY), "restoring removed the lock");

  await resealStored(store.asStorage());
  const raw = store.snapshot();
  assert.ok(!raw.includes("sk-from-the-backup") && !raw.includes("brave-from-the-backup"), "restored keys left in plain text");

  endSession();
  const unlocked = await unlock("correct horse battery", readVault(store.asStorage())!);
  assert.deepEqual(unlocked, { agents: { b1: "sk-from-the-backup" }, search: { brave: "brave-from-the-backup" } });
});

test("restoring a keyless backup while locked leaves the lock on, holding no keys", async () => {
  const store = await lockedStore("correct horse battery");
  const file = JSON.stringify({
    melonBackup: 1,
    scope: "everything",
    containsApiKeys: false,
    data: { "melon.agents": JSON.stringify([{ id: "a1", name: "Claude" }]), "melon.settings": "{}" },
  });
  await applyBackup(describeBackup(file).backup!, store.asStorage(), new MemoryChats());
  await resealStored(store.asStorage());
  endSession();
  assert.deepEqual(await unlock("correct horse battery", readVault(store.asStorage())!), { agents: {}, search: {} });
});

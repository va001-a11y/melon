/**
 * How agents take turns, and how long a discussion may run. Uses the
 * built-in demo model, so no keys and no network.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { runConversation, MAX_ROUNDS } from "../core/src/index.ts";

type Event = { type: string; data: any };

async function run(settings: Record<string, unknown>, agents = [{ id: "a", name: "A", model: "demo-research" }]) {
  const events: Event[] = [];
  await runConversation(
    {
      userMessage: "Discuss.",
      history: [],
      agents: agents.map((a) => ({ ...a, provider: "demo", role: "generalist" })),
      settings: { mode: "professional", detailedCoT: false, maxOutputTokens: 16, sessionOutputBudget: 0, ...settings },
    } as Parameters<typeof runConversation>[0],
    { send: (type: string, data: unknown) => events.push({ type, data }), end() {}, onClose() {} } as any
  );
  return events;
}
const rounds = (events: Event[]) => events.filter((e) => e.type === "round-start").length;

test(`a request for a billion rounds is held to ${MAX_ROUNDS} (v0.6.3)`, async () => {
  assert.equal(rounds(await run({ discussionMode: "rounds", rounds: 1e9 })), MAX_ROUNDS);
});

test("a nonsense or negative round count falls back sensibly; a normal one is untouched", async () => {
  assert.equal(rounds(await run({ discussionMode: "rounds", rounds: "lots" })), 3);
  assert.equal(rounds(await run({ discussionMode: "rounds", rounds: -5 })), 1);
  assert.equal(rounds(await run({ discussionMode: "rounds", rounds: 5 })), 5);
});

test(`"talk until they agree" never runs past ${MAX_ROUNDS}, and says so if it stops there`, async () => {
  const events = await run({ discussionMode: "until-agreed" });
  const n = rounds(events);
  assert.ok(n <= MAX_ROUNDS, `ran ${n}`);
  if (n === MAX_ROUNDS) {
    assert.ok(events.some((e) => e.type === "error" && String(e.data.message).includes("had not agreed")));
  }
});

/** How often the token stream switches from one agent to the other. */
function switches(events: Event[]) {
  const tokens = events.filter((e) => e.type === "token");
  let n = 0;
  for (let i = 1; i < tokens.length; i++) if (tokens[i].data.agentId !== tokens[i - 1].data.agentId) n++;
  return n;
}
const pair = [
  { id: "one", name: "One", model: "demo-research" },
  { id: "two", name: "Two", model: "demo-writer" },
];

test("'Answer simultaneously' really runs agents at the same time", async () => {
  const events = await run({ discussionMode: "single", parallel: true, maxOutputTokens: 200 }, pair);
  assert.ok(switches(events) > 1, "their output interleaves");
});

test("the default relay lets each agent finish before the next starts", async () => {
  const events = await run({ discussionMode: "single", parallel: false, maxOutputTokens: 200 }, pair);
  assert.ok(switches(events) <= 1, "one agent's output, then the other's");
});

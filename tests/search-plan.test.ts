/**
 * Planning a search, cheapest first (2026-11-02). Asked "what are Tiamat /
 * Argus / Khonsu / Gevurah / Drygioni? in the context of SCP?", Melon sent the
 * whole question as one search, got five pages about the two best-known
 * names, and the agents rightly said the other three were not covered.
 *
 * Also here: a provider refusing the Reply length, which Groq reported as a
 * rate limit and Melon passed on as one, though no wait would ever fix it.
 */
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  interleaveHits,
  keyTerms,
  missingTerms,
  parsePlannedQueries,
  PLANNER_SYSTEM,
  splitListQuery,
} from "../core/src/searchPlan.ts";
import { formatSearchContext, searchBudget, searchReserveTokens, MAX_SEARCH_BLOCK_TOKENS } from "../core/src/search.ts";
import { outputLimitFrom } from "../core/src/providers/sse.ts";
import { runConversation } from "../core/src/index.ts";

const SCP = "what are Tiamat / Argus / Khonsu / Gevurah / Drygioni? in the context of SCP?";

/* ---------- the free rule ---------- */

test("a list in the question becomes one query per item, each with the question's context", () => {
  assert.deepEqual(splitListQuery(SCP), ["Tiamat SCP", "Argus SCP", "Khonsu SCP", "Gevurah SCP", "Drygioni SCP"]);
  assert.deepEqual(splitListQuery("Compare Paris, London and Berlin"), ["Paris", "London", "Berlin"]);
});

test("prose that merely contains commas, and short lists, are left as one search", () => {
  for (const q of [
    "However, as I said, the results were mixed and inconclusive.",
    "Is it safe to mix bleach and vinegar?",
    "What is the difference between TCP and UDP?",
    "In 1990, the company, which was founded in Paris, moved.",
  ]) {
    assert.deepEqual(splitListQuery(q), [], q);
  }
});

test("names in a question are what a search is checked for", () => {
  assert.deepEqual(keyTerms(SCP), ["Tiamat", "Argus", "Khonsu", "Gevurah", "Drygioni", "SCP"]);
  assert.deepEqual(keyTerms("what is the tallest mountain?"), [], "nothing named, so nothing can be found missing");
  assert.deepEqual(
    missingTerms(["Khonsu", "SCP"], [{ url: "https://scp-wiki.net/", title: "SCP classes", snippet: "Keter…" }]),
    ["Khonsu"]
  );
});

test("a planner's reply is reduced to its queries", () => {
  const reply = "===REASONING===\nthink\n===ANSWER===\n1. Khonsu SCP object class\n- \"Gevurah SCP\"\n\n* Khonsu SCP object class";
  assert.deepEqual(parsePlannedQueries(reply, "===ANSWER==="), ["Khonsu SCP object class", "Gevurah SCP"]);
  assert.deepEqual(parsePlannedQueries("<think>hmm</think>Drygioni SCP", "===ANSWER==="), ["Drygioni SCP"]);
});

test("merged results take each search's best first, drop duplicates and stop at the cap", () => {
  const h = (url: string) => ({ url });
  const merged = interleaveHits([[h("a1"), h("a2"), h("x")], [h("b1"), h("x")], [h("c1")]], 5);
  assert.deepEqual(merged.map((m) => m.url), ["a1", "b1", "c1", "a2", "x"]);
});

test("more results share the room five had, so the search block does not grow", () => {
  const hits = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ url: `https://e.com/${i}`, title: `t${i}`, snippet: "x".repeat(5000) }));
  const five = formatSearchContext("q", hits(5)).length;
  const eight = formatSearchContext(["q1", "q2"], hits(8)).length;
  assert.ok(eight < five * 1.15, `eight results took ${eight} characters against five's ${five}`);
});

/* ---------- output limits, as each provider words them ---------- */

test("a provider's reply-length limit is read from its refusal, whoever words it", () => {
  const groq =
    "Groq request failed (429) — Provider said: Request too large for model `qwen/qwen3.8-27b` on output tokens per " +
    "minute (OTPM): Limit 1000, Requested 1351. reduce max_tokens and try again.";
  assert.equal(outputLimitFrom(new Error(groq), 1351), 1000);
  assert.equal(outputLimitFrom("max_tokens is too large: 9000. This model supports at most 4096 completion tokens", 9000), 4096);
  assert.equal(outputLimitFrom("max_tokens: 10000 > 8192, which is the maximum allowed number of output tokens", 10000), 8192);
  assert.equal(outputLimitFrom("max_tokens must be less than or equal to 2048", 4096), 2048);
});

test("other refusals are not mistaken for a reply-length limit", () => {
  assert.equal(outputLimitFrom("This model's maximum context length is 8192 tokens; you requested 9000", 2000), null);
  assert.equal(
    outputLimitFrom("Request too large on tokens per minute (TPM): Limit 6000, Requested 7200", 1000),
    null,
    "a limit on the whole request, which a shorter reply does not fix"
  );
  assert.equal(outputLimitFrom("Rate limit reached for requests", 1000), null);
  assert.equal(outputLimitFrom("at most 4096 completion tokens", 1000), null, "already within it");
});

/* ---------- the whole run, with the search engine and the model stood in ---------- */

const realFetch = globalThis.fetch;
let searches: string[] = [];
let modelCalls: { system: string; max: number; user: string }[] = [];

/** Pages that exist for each name, as a real search would find them alone. */
const PAGES: Record<string, string> = {
  Tiamat: "In SCP lore, Tiamat is a classification for anomalies that pose an immediate threat.",
  Argus: "Argus is an SCP esoteric class.",
  Khonsu: "SCP Khonsu objects are contained by being kept in time.",
  Gevurah: "Gevurah is an SCP esoteric class for anomalies requiring judgement.",
  Drygioni: "In SCP, Drygioni describes anomalies whose containment is self-sustaining.",
  Zorblax: "Zorblax Industries was founded by Ada Quill in 1987.",
};

/** Long results, three a query, as a real engine returns for a well-covered name. */
let longResults = false;

function searchResults(query: string) {
  if (longResults) {
    return [1, 2, 3].map((i) => ({ url: `https://wiki.example/${encodeURIComponent(query)}/${i}`, title: `${query} ${i}`, content: "x ".repeat(3000) }));
  }
  // One search for everything returns only the best-known names, as Tavily did.
  if (query.includes("/")) return ["Tiamat", "Argus"].map((n) => ({ url: `https://wiki.example/${n}`, title: `${n} - SCP wiki`, content: PAGES[n] }));
  // A query for the company's founder finds only pages that never name it.
  if (/who founded/i.test(query)) return [{ url: "https://news.example/founders", title: "Founders", content: "Famous founders." }];
  return Object.keys(PAGES)
    .filter((n) => query.includes(n))
    .map((n) => ({ url: `https://wiki.example/${n}`, title: `${n} - SCP wiki`, content: PAGES[n] }));
}

function sse(text: string) {
  return new Response(
    `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n` +
      `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`,
    { status: 200, headers: { "content-type": "text/event-stream" } }
  );
}

before(() => {
  globalThis.fetch = (async (url: string | URL, init: RequestInit = {}) => {
    const href = String(url);
    const body = JSON.parse(String(init.body ?? "{}"));
    if (href.startsWith("https://api.tavily.com/")) {
      searches.push(body.query);
      return new Response(JSON.stringify({ results: searchResults(body.query) }), { status: 200 });
    }
    if (href.includes("/chat/completions")) {
      const system = String(body.messages?.[0]?.content ?? "");
      const user = String(body.messages?.[body.messages.length - 1]?.content ?? "");
      modelCalls.push({ system, max: body.max_tokens, user });
      if (system === PLANNER_SYSTEM) return sse("Zorblax Industries founder");
      if (body.model === "capped" && body.max_tokens > 1000) {
        return new Response(
          JSON.stringify({
            error: { message: "Request too large on output tokens per minute (OTPM): Limit 1000, Requested 1351. Reduce max_tokens." },
          }),
          { status: 429 }
        );
      }
      return sse("An answer.");
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
});
after(() => {
  globalThis.fetch = realFetch;
});
beforeEach(() => {
  searches = [];
  modelCalls = [];
  longResults = false;
});

async function ask(question: string, model = "m", maxOutputTokens = 512, extra: Record<string, unknown> = {}) {
  const events: { type: string; data: any }[] = [];
  await runConversation(
    {
      userMessage: question,
      history: [],
      agents: [{ id: "a", name: "A", model, provider: "groq", apiKey: "test-key", role: "researcher", webSearch: true }],
      settings: {
        mode: "professional",
        detailedCoT: false,
        maxOutputTokens,
        sessionOutputBudget: 0,
        searchProvider: "tavily",
        searchApiKey: "test-search-key",
        ...extra,
      },
    } as Parameters<typeof runConversation>[0],
    { send: (type: string, data: unknown) => events.push({ type, data }), end() {}, onClose() {} } as any
  );
  return events;
}

const prompts = () => modelCalls.filter((c) => c.system !== PLANNER_SYSTEM).map((c) => c.user).join("\n");
const plannerCalls = () => modelCalls.filter((c) => c.system === PLANNER_SYSTEM).length;

test("the SCP question: five searches by the free rule, every name found, and no extra model call", async () => {
  const events = await ask(SCP);
  assert.deepEqual(events.filter((e) => e.type === "agent-error").map((e) => e.data.message), []);
  assert.equal(searches.length, 5);
  assert.equal(plannerCalls(), 0, "the rule found everything, so no model was asked");
  for (const name of ["Khonsu", "Gevurah", "Drygioni"]) assert.ok(prompts().includes(PAGES[name]), name);
});

test("a question the first search answers costs one search and no extra model call", async () => {
  await ask("What is Khonsu in SCP?");
  assert.equal(searches.length, 1);
  assert.equal(plannerCalls(), 0);
});

test("only when a name is missing from the results is a model asked for queries, once", async () => {
  await ask("Who founded Zorblax Industries?");
  assert.equal(plannerCalls(), 1);
  assert.deepEqual(searches, ["Who founded Zorblax Industries?", "Zorblax Industries founder"]);
  assert.ok(prompts().includes(PAGES.Zorblax), "the planned search's page reaches the agent");
});

test("a refused reply length is asked again at the provider's limit, and the card is told", async () => {
  const events = await ask("What is Khonsu in SCP?", "capped", 1351);
  assert.deepEqual(events.filter((e) => e.type === "agent-error").map((e) => e.data.message), []);
  const answers = modelCalls.filter((c) => c.system !== PLANNER_SYSTEM);
  assert.deepEqual(answers.map((c) => c.max), [1351, 1000]);
  const done = events.find((e) => e.type === "agent-done");
  assert.deepEqual(done?.data.capped, { to: 1000, from: 1351, by: "Groq (very fast)" });
  assert.equal(done?.data.replyLimit, 1000);
});

/* ---------- how many items a list may search (v0.8.0) ---------- */

test("the room for results scales with the smallest model, and decides how many items fit", () => {
  const small = searchBudget(8_192, 25);
  assert.equal(small.textChars, 7500, "an 8k model keeps the old room");
  assert.equal(small.items, 12, "which fits twelve useful snippets, not twenty-five");
  assert.equal(small.limitedBy, "room");

  const large = searchBudget(128_000, 25);
  assert.deepEqual([large.items, large.maxHits, large.textChars, large.limitedBy], [25, 25, 37_500, "setting"]);

  assert.deepEqual([searchBudget(128_000).items, searchBudget(128_000).limitedBy], [5, "setting"], "five unless asked");
  assert.equal(searchBudget(128_000, 999).items, 25, "never past 25");
  assert.equal(searchBudget(128_000, Number.NaN).items, 5);
});

test("the context guard reserves what the budget may use, and no less than before", () => {
  assert.equal(searchReserveTokens("tavily", false, searchBudget(8_192)), MAX_SEARCH_BLOCK_TOKENS);
  assert.ok(searchReserveTokens("tavily", false, searchBudget(128_000, 25)) > 37_500 / 4);
});

test("a snippet never grows past 1,500 characters, whatever the room", () => {
  const hits = [1, 2].map((i) => ({ url: `https://e.com/${i}`, title: `t${i}`, snippet: "x".repeat(9000) }));
  const block = formatSearchContext("q", hits, 37_500);
  assert.ok(block.length < 2 * 1500 + 1000, `two results took ${block.length} characters`);
});

test("items past the limit are named for the model, not silently dropped", () => {
  const names = Array.from({ length: 40 }, (_, i) => `Item${i + 1}`);
  const block = formatSearchContext(names.slice(0, 5), [], 7500, names.slice(5));
  assert.match(block, /NOT SEARCHED/);
  assert.match(block, /"Item6"/);
  assert.match(block, /and 5 more/, "thirty named, the rest counted");
});

const forty = `what are ${Array.from({ length: 40 }, (_, i) => `Zed${i + 1}`).join(" / ")} in Testverse?`;

test("a forty-item list searches five by default, tells the model and the card, and calls no model to plan", async () => {
  const events = await ask(forty);
  assert.equal(searches.length, 5);
  assert.equal(plannerCalls(), 0, "a planner could not cover thirty-five more, so it is not paid for");
  assert.match(prompts(), /NOT SEARCHED/);
  const done = events.find((e) => e.type === "agent-done");
  assert.deepEqual(done?.data.coverage, { searched: 5, of: 40, limitedBy: "setting" });
});

test("with the setting at 25 and room for it, twenty-five are searched", async () => {
  const events = await ask(forty, "m", 512, { searchItems: 25 });
  assert.equal(searches.length, 25);
  assert.deepEqual(events.find((e) => e.type === "agent-done")?.data.coverage, { searched: 25, of: 40, limitedBy: "setting" });
});

test("set to one item, a list is searched whole, as before splitting existed", async () => {
  const events = await ask(SCP, "m", 512, { searchItems: 1 });
  assert.deepEqual(searches.slice(0, 1), [SCP]);
  assert.equal(events.find((e) => e.type === "agent-done")?.data.coverage, undefined);
});

/* ---------- after the first live run (2026-11-04) ---------- */

test("a name mentioned in passing is not found: a result must be about it", () => {
  const passing = [{ url: "https://fanon.example/list", title: "List of classes", snippet: "Gevurah appears as an error message." }];
  assert.deepEqual(missingTerms(["Gevurah"], passing), ["Gevurah"]);
  assert.deepEqual(missingTerms(["Gevurah"], [{ url: "https://w.example/Gevurah", title: "Classes", snippet: "" }]), []);
  assert.deepEqual(missingTerms(["Gevurah"], [{ url: "https://w.example/x", title: "Gevurah - SCP wiki", snippet: "" }]), []);
});

test("the model is told that missing from the results is not evidence of anything", () => {
  const block = formatSearchContext("q", [{ url: "https://e.com/", title: "t", snippet: "s" }]);
  assert.match(block, /never conclude/i);
  assert.match(block, /does not exist/);
  assert.match(block, /used but not defined/, "an example of a term is not its definition");
});

test("five items on Automatic get the room five items always had, not the most allowed", async () => {
  // A five-item question on Automatic was handed 15 full-length results — 6,500
  // tokens in one request — and Groq's free tier refused it (2026-11-06).
  longResults = true;
  await ask(SCP, "m", 512, { searchItems: 25 });
  const prompt = prompts();
  const block = prompt.slice(prompt.indexOf("WEB SEARCH RESULTS"));
  const results = (block.match(/^\[\d+\] /gm) ?? []).length;
  assert.ok(results <= 8, `${results} results`);
  assert.ok(block.length < 7500 + 3500, `${block.length} characters of search results`);
});

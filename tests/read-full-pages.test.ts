/**
 * "Read full pages": the top results are read in full through Jina Reader,
 * within a fixed share of the model's context. No network — Jina is replaced
 * with a stand-in.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  readFullPages,
  formatSearchContext,
  searchReserveTokens,
  MAX_SEARCH_BLOCK_TOKENS,
  MAX_READ_BLOCK_TOKENS,
} from "../core/src/search.ts";
import { runConversation } from "../core/src/index.ts";

const hit = (n: number, extra: Record<string, unknown> = {}) => ({
  url: `https://site${n}.test/p`,
  title: `T${n}`,
  snippet: `snippet ${n}`,
  ...extra,
});

/** Jina stand-in: site2 fails, site3 comes back empty, the rest succeed. */
function fakeJina(calls: string[]) {
  globalThis.fetch = (async (url: string | URL, init: RequestInit = {}) => {
    const target = JSON.parse(String(init.body)).url as string;
    assert.equal(String(url), "https://r.jina.ai/");
    assert.equal(init.method, "POST");
    calls.push(target);
    if (target.includes("site2")) return new Response("boom", { status: 500 });
    if (target.includes("site3")) return new Response(JSON.stringify({ data: { content: "" } }), { status: 200 });
    return new Response(JSON.stringify({ data: { content: `FULL PAGE of ${target}` } }), { status: 200 });
  }) as typeof fetch;
}

test("only the top three are read; a failed or empty read keeps its snippet", async () => {
  const calls: string[] = [];
  fakeJina(calls);
  const out = await readFullPages([hit(1), hit(2), hit(3), hit(4), hit(5)]);
  assert.equal(calls.length, 3);
  assert.ok(out[0].snippet.startsWith("FULL PAGE") && out[0].fullPage === true);
  assert.equal(out[1].snippet, "snippet 2");
  assert.equal(out[2].snippet, "snippet 3");
  assert.equal(out[3].snippet, "snippet 4");
});

test("a page already read (Firecrawl) is not read again", async () => {
  const calls: string[] = [];
  fakeJina(calls);
  const out = await readFullPages([hit(1, { fullPage: true, snippet: "already whole" }), hit(4)]);
  assert.equal(calls.length, 1);
  assert.equal(out[0].snippet, "already whole");
});

test("a non-web URL is never sent to Jina", async () => {
  const calls: string[] = [];
  fakeJina(calls);
  const out = await readFullPages([{ url: "javascript:alert(1)", title: "x", snippet: "kept" }]);
  assert.equal(calls.length, 0);
  assert.equal(out[0].snippet, "kept");
});

test("pressing Stop mid-read keeps the snippets and does not throw", async () => {
  const ac = new AbortController();
  globalThis.fetch = ((_url: string, init: RequestInit) =>
    new Promise((_, reject) => init.signal!.addEventListener("abort", () => reject(new Error("aborted"))))) as typeof fetch;
  const pending = readFullPages([hit(1), hit(4)], ac.signal);
  ac.abort();
  const out = await pending;
  assert.equal(out[0].snippet, "snippet 1");
});

test("five 50,000-character pages still fit the space reserved for them", () => {
  const long = "x".repeat(50000);
  const block = formatSearchContext("q", [1, 2, 3, 4, 5].map((n) => hit(n, { snippet: long, fullPage: true })));
  const lens = block
    .split(/\n\n(?=\[\d\] )/)
    .slice(1)
    .map((s) => s.split("\n").slice(2).join("\n").length);
  assert.ok(lens.slice(0, 3).every((l) => l > 2000 && l <= 3010), `first three get the larger allowance: ${lens}`);
  assert.ok(lens.slice(3).every((l) => l <= 1510), `the rest are cut to snippet size: ${lens}`);
  assert.ok(Math.ceil(block.length / 4) <= MAX_READ_BLOCK_TOKENS);
  const plain = formatSearchContext("q", [1, 2, 3, 4, 5].map((n) => hit(n, { snippet: long })));
  assert.ok(Math.ceil(plain.length / 4) <= MAX_SEARCH_BLOCK_TOKENS);
});

test("the context reserve grows only when pages are read", () => {
  assert.equal(searchReserveTokens("serper", false), MAX_SEARCH_BLOCK_TOKENS);
  assert.equal(searchReserveTokens("serper", true), MAX_READ_BLOCK_TOKENS);
  assert.equal(searchReserveTokens("firecrawl", false), MAX_READ_BLOCK_TOKENS, "Firecrawl always returns pages");
});

async function conversation(readFullPages: boolean) {
  const counts = { serper: 0, jina: 0 };
  globalThis.fetch = (async (url: string | URL) => {
    const u = String(url);
    if (u.startsWith("https://google.serper.dev/")) {
      counts.serper++;
      const organic = [1, 2, 3, 4, 5].map((n) => ({ link: `https://p${n}.test/`, title: `P${n}`, snippet: `one line ${n}` }));
      return new Response(JSON.stringify({ organic }), { status: 200 });
    }
    if (u === "https://r.jina.ai/") {
      counts.jina++;
      return new Response(JSON.stringify({ data: { content: "Whole page text. ".repeat(80) } }), { status: 200 });
    }
    throw new Error("unexpected fetch: " + u);
  }) as typeof fetch;
  const events: { type: string; data: any }[] = [];
  await runConversation(
    {
      userMessage: "What is the latest Node.js LTS release?",
      history: [],
      agents: [
        { id: "a", name: "A", provider: "demo", model: "demo-research", role: "generalist", webSearch: true },
        { id: "b", name: "B", provider: "demo", model: "demo-writer", role: "generalist", webSearch: true },
      ],
      settings: {
        mode: "professional",
        detailedCoT: false,
        maxOutputTokens: 60,
        sessionOutputBudget: 0,
        discussionMode: "single",
        searchProvider: "serper",
        searchApiKey: "k",
        readFullPages,
      },
    } as Parameters<typeof runConversation>[0],
    { send: (type: string, data: unknown) => events.push({ type, data }), end() {}, onClose() {} } as any
  );
  return { counts, events };
}

test("two agents share one search and one set of page reads", async () => {
  const { counts, events } = await conversation(true);
  const done = events.filter((e) => e.type === "agent-done");
  assert.equal(done.length, 2);
  assert.ok(done.every((e) => e.data.searched === true));
  assert.equal(counts.serper, 1, "one search, not one per agent");
  assert.equal(counts.jina, 3, "three reads, not six");
  assert.ok(!events.some((e) => e.type === "error" || e.type === "agent-error"));
});

test("with reading off, Jina is never called", async () => {
  const { counts } = await conversation(false);
  assert.equal(counts.jina, 0);
  assert.equal(counts.serper, 1);
});

/**
 * Following links before answering (v0.8.0). The agent picks pages by label
 * from links that really appeared in its sources, Melon opens them, and they
 * become numbered sources — up to the user's limit, and never at the cost of
 * the answer itself.
 */
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  LINK_SELECT_SYSTEM,
  linkLimitOf,
  linksIn,
  parseSelection,
  plainText,
  rankLinks,
} from "../core/src/followLinks.ts";
import { runConversation } from "../core/src/index.ts";

/* ---------- the pieces ---------- */

test("links are read out of a page as absolute addresses, without images, anchors or repeats", () => {
  const md =
    "See [Khonsu](/wiki/khonsu) and [Gevurah](https://scp.example/wiki/gevurah \"title\").\n" +
    "![logo](/logo.png) [Top](#top) [Khonsu again](/wiki/khonsu#history) [mail](mailto:a@b.c) [ ](/blank)";
  assert.deepEqual(linksIn(md, "https://scp.example/wiki/classes"), [
    { url: "https://scp.example/wiki/khonsu", text: "Khonsu" },
    { url: "https://scp.example/wiki/gevurah", text: "Gevurah" },
  ]);
});

test("page text reaches the model without any addresses in it", () => {
  assert.equal(plainText("Read [the rules](https://evil.example/?q=x) now. ![i](/i.png)"), "Read the rules now.");
});

test("an agent's choice is read as labels only, never as an address it typed", () => {
  const valid = new Set(["L1", "L2", "L3"]);
  assert.deepEqual(parseSelection("L2\nl3\nL2", "===ANSWER===", 5, valid), ["L2", "L3"]);
  assert.deepEqual(parseSelection("L1 L2 L3", "===ANSWER===", 2, valid), ["L1", "L2"], "no more than allowed");
  assert.deepEqual(parseSelection("L9", "===ANSWER===", 5, valid), [], "a label that was never offered");
  assert.equal(parseSelection("DONE", "===ANSWER===", 5, valid), "done");
  assert.deepEqual(parseSelection("https://evil.example/?q=secret", "===ANSWER===", 5, valid), []);
  assert.deepEqual(parseSelection("===REASONING===\nL1?\n===ANSWER===\nL3", "===ANSWER===", 5, valid), ["L3"]);
});

test("links that mention what was asked are offered first", () => {
  const ranked = rankLinks(
    [
      { url: "https://x/home", text: "Home" },
      { url: "https://x/wiki/khonsu", text: "Khonsu" },
    ],
    ["Khonsu"]
  );
  assert.equal(ranked[0].text, "Khonsu");
});

test("the page limit is held between one and ten", () => {
  assert.deepEqual([linkLimitOf(0), linkLimitOf(3), linkLimitOf(99), linkLimitOf("x")], [3, 3, 10, 3]);
});

/* ---------- the whole run, with search, page reader and model stood in ---------- */

const realFetch = globalThis.fetch;
let reads: string[] = [];
let selections: string[] = [];
/** The reply length each hidden choice asked for. */
let selectionMax: number[] = [];
let answers: string[] = [];
let jinaFails = false;
/** How the stand-in model chooses: by the label beside a link mentioning this word, then DONE. */
let chooseFor = ["classes", "khonsu"];
let replyInstead: string | null = null;
let answerText = "Khonsu anomalies are kept in time [2].";

const PAGES: Record<string, string> = {
  "https://scp.example/wiki/classes":
    "Esoteric classes include [Khonsu](/wiki/khonsu) and [Gevurah](/wiki/gevurah). [Home](/) " +
    "[Sign in](https://evil.example/login?next=steal)",
  "https://scp.example/wiki/khonsu": "Khonsu: anomalies contained by being kept in time. See [Classes](/wiki/classes).",
  "https://scp.example/wiki/gevurah": "Gevurah: anomalies requiring judgement.",
};

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
      return new Response(
        JSON.stringify({
          results: [{ url: "https://scp.example/wiki/classes", title: "Esoteric classes in SCP: Khonsu, Gevurah", content: "Khonsu and others." }],
        }),
        { status: 200 }
      );
    }
    if (href === "https://r.jina.ai/") {
      reads.push(body.url);
      if (jinaFails || !PAGES[body.url]) return new Response("no", { status: 502 });
      return new Response(JSON.stringify({ data: { title: body.url.split("/").pop(), content: PAGES[body.url] } }), {
        status: 200,
      });
    }
    if (href.includes("/chat/completions")) {
      const system = String(body.messages?.[0]?.content ?? "");
      const user = String(body.messages?.[body.messages.length - 1]?.content ?? "");
      if (system === LINK_SELECT_SYSTEM) {
        selectionMax.push(body.max_tokens);
        // A provider that, like Groq's free tier, allows this model 1,000 output tokens.
        if (body.model === "capped" && body.max_tokens > 1000) {
          return new Response(
            JSON.stringify({ error: { message: "on output tokens per minute (OTPM): Limit 1000, Requested 1024. Reduce max_tokens." } }),
            { status: 429 }
          );
        }
        selections.push(user);
        if (replyInstead !== null) return sse(replyInstead);
        const want = chooseFor[selections.length - 1];
        const line = want && user.split("\n").find((l) => /^L\d+:/.test(l) && l.toLowerCase().includes(want));
        return sse(line ? line.split(":")[0] : "DONE");
      }
      answers.push(body.messages.map((m: any) => String(m.content)).join("\n"));
      return sse(answerText);
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
});
after(() => {
  globalThis.fetch = realFetch;
});
beforeEach(() => {
  reads = [];
  selections = [];
  selectionMax = [];
  answers = [];
  jinaFails = false;
  chooseFor = ["classes", "khonsu"];
  replyInstead = null;
  answerText = "Khonsu anomalies are kept in time [2].";
});

async function ask(followLinks: boolean, linkLimit = 3, model = "m") {
  const events: { type: string; data: any }[] = [];
  await runConversation(
    {
      userMessage: "What is Khonsu in SCP?",
      history: [],
      agents: [
        { id: "a", name: "A", model, provider: "groq", apiKey: "k", role: "researcher", webSearch: true, followLinks },
      ],
      settings: {
        mode: "professional",
        detailedCoT: false,
        maxOutputTokens: 512,
        sessionOutputBudget: 0,
        searchProvider: "tavily",
        searchApiKey: "s",
        linkLimit,
      },
    } as Parameters<typeof runConversation>[0],
    { send: (type: string, data: unknown) => events.push({ type, data }), end() {}, onClose() {} } as any
  );
  return events;
}

test("the agent opens the result, follows its link to the page it needs, and cites it", async () => {
  const events = await ask(true);
  assert.deepEqual(events.filter((e) => e.type === "agent-error").map((e) => e.data.message), []);
  assert.deepEqual(reads, ["https://scp.example/wiki/classes", "https://scp.example/wiki/khonsu"]);
  assert.equal(selections.length, 3, "two choices, then DONE");
  assert.match(answers[0], /PAGES OPENED/);
  assert.match(answers[0], /kept in time/);
  assert.ok(!answers[0].includes("evil.example"), "no address from inside a page reaches the answer");

  const done = events.find((e) => e.type === "agent-done");
  assert.deepEqual(
    done.data.citations.map((c: any) => [c.n, c.url]),
    [[2, "https://scp.example/wiki/khonsu"]],
    "the opened page is numbered on from the search result, and cited by that number"
  );
  assert.ok(events.some((e) => e.type === "reading" && e.data.opened === 2 && e.data.limit === 3));
});

test("it stops at the page limit, however much more the agent wants", async () => {
  await ask(true, 1);
  assert.deepEqual(reads, ["https://scp.example/wiki/classes"]);
  assert.equal(selections.length, 1);
});

test("switched off, nothing extra is asked or read", async () => {
  await ask(false);
  assert.equal(selections.length, 0);
  assert.equal(reads.length, 0);
  assert.equal(answers.length, 1);
});

test("an address typed instead of a label opens nothing", async () => {
  replyInstead = "https://evil.example/?q=what-is-khonsu";
  await ask(true);
  assert.deepEqual(reads, []);
  assert.equal(answers.length, 1, "and the agent still answers");
});

test("pages that cannot be read leave the answer intact", async () => {
  jinaFails = true;
  const events = await ask(true);
  assert.deepEqual(events.filter((e) => e.type === "agent-error"), []);
  assert.equal(answers.length, 1);
  assert.ok(!answers[0].includes("PAGES OPENED"));
});

test("the cost shown before sending includes the worst case of following links", async () => {
  const { estimateRun } = await import("../client/src/cost.ts");
  const settings = {
    maxOutputTokens: 1000,
    detailedCoT: false,
    searchProvider: "tavily",
    searchApiKeys: { tavily: "s" },
    linkLimit: 3,
  } as any;
  const agent = (provider: string, followLinks: boolean) =>
    ({ id: "a", provider, model: "llama-3.3-70b-versatile", baseUrl: "", webSearch: true, followLinks }) as any;

  const off = estimateRun([agent("groq", false)], settings, 1000, 100);
  const on = estimateRun([agent("groq", true)], settings, 1000, 100);
  assert.ok(on.inputTokens > off.inputTokens + 3 * 2500, `${on.inputTokens} against ${off.inputTokens}`);

  // A provider that searches by itself never shows Melon its results, so there is nothing to follow.
  const native = estimateRun([agent("anthropic", true)], settings, 1000, 100);
  assert.equal(native.inputTokens, estimateRun([agent("anthropic", false)], settings, 1000, 100).inputTokens);
});

/* ---------- after the first live run (2026-11-04) ---------- */

test("the card is told which sources were read in full, results included", async () => {
  // An answer citing nothing keeps every source, so both opened pages show.
  answerText = "No citations here.";
  const events = await ask(true);
  const done = events.find((e) => e.type === "agent-done");
  assert.deepEqual(
    done.data.citations.map((c: any) => [c.url, c.opened === true]),
    [
      ["https://scp.example/wiki/classes", true],
      ["https://scp.example/wiki/khonsu", true],
    ]
  );
});

test("choosing pages has room to think, and a provider's lower limit is respected", async () => {
  await ask(true);
  assert.equal(selectionMax[0], 1024, "300 left a reasoning model no room to write its choice");
  selectionMax = [];
  selections = [];
  await ask(true, 3, "capped");
  assert.deepEqual(
    selectionMax,
    [1024, 1000, 1000, 1000],
    "refused once, then asked at the provider's limit from the start for the rest of the run"
  );
});

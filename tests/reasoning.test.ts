/**
 * Separating a model's thinking from its answer.
 *
 * splitCot once had eighteen tests, every one describing a model that
 * followed the format it was given — and the bugs were in what models
 * actually did. These cases are what they actually did: recite the format,
 * wrap thinking in tags, split those tags across network chunks.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { splitCot, stripConclusion, stripSpeakerLabel } from "../client/src/cot.ts";
import { openai } from "../core/src/providers/openai.ts";

const R = "===REASONING===";
const A = "===ANSWER===";

test("reasoning and answer are separated", () => {
  const out = splitCot(`${R}\nCheck the dates.\n${A}\nIt is 1066.`);
  assert.equal(out.cot, "Check the dates.");
  assert.equal(out.answer, "It is 1066.");
  assert.equal(out.reasoningInProgress, false);
});

test("a model that recites the format does not cut its own answer in half (v0.6.1)", () => {
  // Nemotron quoted the instructions inside its reasoning, end-marker and
  // all, on a line of its own. Taking the first end-marker started the
  // answer mid-deliberation.
  const text =
    `${R}\nThe format is:\n\`\`\`\n${R}\n<reasoning>\n${A}\n<answer>\n\`\`\`\n` +
    `So: the capital of France is Paris.\n${A}\nParis.`;
  const out = splitCot(text);
  assert.equal(out.answer, "Paris.");
  assert.ok(out.cot.includes("the capital of France is Paris"));
});

test("while the reasoning is still streaming, nothing reaches the answer", () => {
  const out = splitCot(`${R}\nStill thinking about`);
  assert.equal(out.reasoningInProgress, true);
  assert.equal(out.answer, "");
});

test("a half-written marker at the end of a stream never shows", () => {
  assert.equal(splitCot("The answer is 4. ===REA").answer, "The answer is 4.");
});

test("Continue appends a second reasoning block; both are read", () => {
  const out = splitCot(`${R}\nfirst plan\n${A}\nThe first half, ${R}\nsecond plan\n${A}\nand the second.`);
  assert.equal(out.answer, "The first half, and the second.");
  assert.equal(out.cot, "first plan\n\nsecond plan");
});

test("the agreement marker is machinery and never shown, even half-written", () => {
  assert.equal(stripConclusion("Agreed, it is 4. ===CONCLUDED==="), "Agreed, it is 4.");
  assert.equal(stripConclusion("Agreed, it is 4. ===CONCL"), "Agreed, it is 4.");
});

test("a model writing a teammate's name as a label loses the label, not the reply", () => {
  assert.equal(stripSpeakerLabel("[Ana]: Hello there", ["Ana"]), "Hello there");
  assert.equal(stripSpeakerLabel("Ana: Hello there", ["Ana"]), "Hello there");
  assert.equal(stripSpeakerLabel("Note: this stays", ["Ana"]), "Note: this stays", "only names in this run");
});

// ---------------------------------------------------------------------------
// The OpenAI-compatible adapter, which speaks for a dozen services. Fed a
// stream the way a provider sends it, cut at awkward places.

function sse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}
const delta = (d: Record<string, string>) => `data: ${JSON.stringify({ choices: [{ delta: d }] })}\n\n`;

async function stream(chunks: string[], extra: Record<string, unknown> = {}) {
  let sent: Record<string, any> = {};
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    sent = JSON.parse(String(init.body));
    return sse(chunks);
  }) as typeof fetch;
  const result = await openai.chat({
    model: "m",
    apiKey: "k",
    baseUrl: "https://example.test/v1",
    system: "s",
    messages: [{ role: "user", content: "hi" }],
    maxOutputTokens: 100,
    signal: new AbortController().signal,
    handlers: { onToken() {} },
    ...extra,
  } as Parameters<typeof openai.chat>[0]);
  return { ...splitCot(result.text), sent };
}

test("<think> tags split across network chunks still land in the reasoning (v0.6.0)", async () => {
  const out = await stream([
    delta({ content: "<thi" }),
    delta({ content: "nk>planning" }),
    delta({ content: " more</th" }),
    delta({ content: "ink>The answer." }),
    "data: [DONE]\n\n",
  ]);
  assert.equal(out.cot, "planning more");
  assert.equal(out.answer, "The answer.");
});

test("<thinking> is recognised too, and not torn apart as <think>", async () => {
  const out = await stream([delta({ content: "<thinking>hmm</thinking>Done." }), "data: [DONE]\n\n"]);
  assert.equal(out.cot, "hmm");
  assert.equal(out.answer, "Done.");
});

test("a '<' that never becomes a tag is released as ordinary text", async () => {
  const out = await stream([delta({ content: "1 <" }), delta({ content: " 2, and x <t" }), "data: [DONE]\n\n"]);
  assert.equal(out.answer, "1 < 2, and x <t");
});

test("reasoning sent in a field goes to the drawer, not the answer", async () => {
  const out = await stream([
    delta({ reasoning_content: "deepseek thinks" }),
    delta({ content: "Answer A." }),
    "data: [DONE]\n\n",
  ]);
  assert.equal(out.cot, "deepseek thinks");
  assert.equal(out.answer, "Answer A.");
  const or = await stream([delta({ reasoning: "openrouter thinks" }), delta({ content: "Answer B." }), "data: [DONE]\n\n"]);
  assert.equal(or.cot, "openrouter thinks");
  assert.equal(or.answer, "Answer B.");
});

test("an SSE line split between two network chunks is reassembled", async () => {
  const line = delta({ content: "Whole sentence." });
  const out = await stream([line.slice(0, 17), line.slice(17), "data: [DONE]\n\n"]);
  assert.equal(out.answer, "Whole sentence.");
});

test("OpenRouter is told not to reason when reasoning is off — and only OpenRouter", async () => {
  const off = await stream([delta({ content: "x" }), "data: [DONE]\n\n"], { providerId: "openrouter", detailedCoT: false });
  assert.deepEqual(off.sent.reasoning, { enabled: false });
  const on = await stream([delta({ content: "x" }), "data: [DONE]\n\n"], { providerId: "openrouter", detailedCoT: true });
  assert.equal(on.sent.reasoning, undefined);
  const other = await stream([delta({ content: "x" }), "data: [DONE]\n\n"], { providerId: "groq", detailedCoT: false });
  assert.equal(other.sent.reasoning, undefined);
});

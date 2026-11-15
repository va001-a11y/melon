/**
 * A short rate-limit wait, sat out (2026-11-15). Groq refused an answer with
 * "Please try again in 5.7s" — its free tier's tokens-a-minute allowance,
 * mostly spent seconds earlier on planning a search and choosing pages — and
 * Melon reported it as a failure. Short waits are now waited out.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { openai } from "../core/src/providers/openai.ts";
import { rateLimitWait } from "../core/src/providers/sse.ts";

const realFetch = globalThis.fetch;
after(() => {
  globalThis.fetch = realFetch;
});

let calls = 0;
let refusals: Response[] = [];

function sse(text: string) {
  return new Response(
    `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n` +
      `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`,
    { status: 200, headers: { "content-type": "text/event-stream" } }
  );
}
const groq429 = (wait: string) =>
  new Response(
    JSON.stringify({ error: { message: `Rate limit reached on input tokens per minute (ITPM): Limit 7000, Used 4336, Requested 3329. Please try again in ${wait}.` } }),
    { status: 429 }
  );

globalThis.fetch = (async () => {
  calls++;
  return refusals.shift() ?? sse("Answer.");
}) as typeof fetch;

function ask() {
  calls = 0;
  return openai.chat({
    model: "qwen/qwen3.8-27b",
    apiKey: "k",
    baseUrl: "https://api.example/v1",
    providerId: "groq",
    providerLabel: "Groq",
    system: "s",
    messages: [{ role: "user", content: "Hi" }],
    maxOutputTokens: 100,
    signal: new AbortController().signal,
    handlers: { onToken: () => {} },
  } as any);
}

test("a wait is read from the header, or from the provider's own words", async () => {
  assert.equal(await rateLimitWait(new Response("", { status: 429, headers: { "retry-after": "2" } })), 2000);
  assert.equal(await rateLimitWait(groq429("5.7s")), 5700);
  assert.equal(await rateLimitWait(groq429("1m12.3s")), 72300);
  assert.equal(await rateLimitWait(new Response("Too many requests", { status: 429 })), null);
});

test("a short wait is sat out, and the answer arrives", async () => {
  refusals = [groq429("0.05s")];
  const result = await ask();
  assert.equal(result.text, "Answer.");
  assert.equal(calls, 2);
});

test("a long wait is reported, not sat through", async () => {
  refusals = [groq429("2m12.3s")];
  await assert.rejects(ask(), /429/);
  assert.equal(calls, 1);
});

test("a provider that keeps refusing is given up on after two waits", async () => {
  refusals = [groq429("0.01s"), groq429("0.01s"), groq429("0.01s"), groq429("0.01s")];
  await assert.rejects(ask(), /429/);
  assert.equal(calls, 3);
  refusals = [];
});

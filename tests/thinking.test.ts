/**
 * Switching a model's own thinking off (v0.8.0). Each provider spells the
 * switch its own way, some models cannot switch it off at all, and NVIDIA's
 * hosted API is not documented to accept its switch — so a refusal is asked
 * again without it, rather than failing the agent over an optional field.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { thinkingSwitch } from "../core/src/thinking.ts";
import { openai } from "../core/src/providers/openai.ts";
import { toRunAgent } from "../client/src/wire.ts";

test("the switch is offered only where a known control works", () => {
  const kind = (p: string, m: string) => thinkingSwitch(p, m)?.kind ?? null;
  assert.equal(kind("nvidia", "nvidia/nvidia-nemotron-3.5-lightning-30b-a3b"), "nvidia-kwargs");
  assert.equal(kind("nvidia", "nvidia/llama-3.3-nemotron-super-49b-v1"), "nvidia-prompt");
  assert.equal(kind("nvidia", "meta/muse-glimmer"), null, "NVIDIA documents that this one cannot stop thinking");
  assert.equal(kind("groq", "qwen/qwen3.8-27b"), "groq-effort");
  assert.equal(kind("groq", "openai/gpt-oss-20b"), null, "GPT-OSS cannot switch reasoning off");
  assert.equal(kind("openrouter", "anything/at-all"), "openrouter");
  assert.equal(kind("ollama", "qwen3:8b"), "ollama");
  assert.equal(kind("google", "gemini-2.5-flash"), "gemini-budget");
  assert.equal(kind("google", "gemini-2.5-pro"), null, "2.5 Pro cannot switch thinking off");
  assert.equal(kind("anthropic", "claude-sonnet-4-5"), null);
});

/* ---------- what each provider is sent ---------- */

const realFetch = globalThis.fetch;
after(() => {
  globalThis.fetch = realFetch;
});
let bodies: any[] = [];
let refuseKwargs = false;

function sse(text: string) {
  return new Response(
    `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n` +
      `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`,
    { status: 200, headers: { "content-type": "text/event-stream" } }
  );
}

globalThis.fetch = (async (_url: string | URL, init: RequestInit = {}) => {
  const body = JSON.parse(String(init.body));
  bodies.push(body);
  if (refuseKwargs && body.chat_template_kwargs) {
    return new Response(JSON.stringify({ error: { message: "Unrecognized field: chat_template_kwargs" } }), { status: 400 });
  }
  return sse("Answer.");
}) as typeof fetch;

async function send(providerId: string, model: string, thinkingOff: boolean) {
  bodies = [];
  return openai.chat({
    model,
    apiKey: "k",
    baseUrl: "https://api.example/v1",
    providerId,
    providerLabel: providerId,
    system: "You are helpful.",
    messages: [{ role: "user", content: "Hi" }],
    maxOutputTokens: 100,
    thinkingOff,
    signal: new AbortController().signal,
    handlers: { onToken: () => {} },
  } as any);
}

test("each provider gets its own switch, and only when asked", async () => {
  await send("nvidia", "nvidia/nvidia-nemotron-3.5-lightning", true);
  assert.deepEqual(bodies[0].chat_template_kwargs, { enable_thinking: false });

  await send("nvidia", "nvidia/llama-3.3-nemotron-super-49b-v1", true);
  assert.match(bodies[0].messages[0].content, /^detailed thinking off\n\nYou are helpful\./);

  await send("groq", "qwen/qwen3.8-27b", true);
  assert.equal(bodies[0].reasoning_effort, "none");

  await send("openrouter", "x/y", true);
  assert.deepEqual(bodies[0].reasoning, { enabled: false });

  await send("groq", "openai/gpt-oss-20b", true);
  assert.equal(bodies[0].reasoning_effort, undefined, "a model that cannot stop thinking is not sent a switch");

  await send("nvidia", "nvidia/nvidia-nemotron-3.5-lightning", false);
  assert.equal(bodies[0].chat_template_kwargs, undefined, "left alone when thinking is on");
});

test("a provider refusing the switch is asked again without it, and the reply says so", async () => {
  refuseKwargs = true;
  const result = await send("nvidia", "nvidia/nvidia-nemotron-3.5-lightning", true);
  refuseKwargs = false;
  assert.equal(result.text, "Answer.");
  assert.equal(result.thinkingSwitchRefused, true);
  assert.equal(bodies.length, 2);
  assert.equal(bodies[1].chat_template_kwargs, undefined);
});

test("the switch reaches the run from the agent's properties", () => {
  const spec = toRunAgent({ id: "a", name: "N", provider: "nvidia", model: "m", apiKey: "", baseUrl: "", role: "r", personality: "", active: true, color: "", thinkingOff: true } as any, {});
  assert.equal(spec.thinkingOff, true);
});

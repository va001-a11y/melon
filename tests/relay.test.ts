/**
 * A relay that went wrong three ways at once (2026-10-29). Two agents, Qwen
 * then GPT OSS, one of them renamed earlier in the chat from "Nemotron 3.5
 * Lightning". Asked about Darwin after a question about peptidoglycan:
 *
 *  - Qwen answered, then carried on writing a second answer headed
 *    "[Nemotron 3.5 Lightning]:", published on Qwen's card;
 *  - GPT OSS answered the previous question, about peptidoglycan;
 *  - Qwen's prose cited [4] and [5] under a list numbered 1 and 2.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { buildMessages, cutAtAnotherTurn, runConversation } from "../core/src/index.ts";
import { pruneUnusedSources } from "../core/src/search.ts";
import { splitCot } from "../client/src/cot.ts";

const QWEN_REPLY =
  "Acceptance was not instantaneous [5].\n\nIt is worth noting that [4] discusses the Neutral Theory.\n\nConfidence: 99%.\n\n" +
  "[Nemotron 3.5 Lightning]: If by “partially accepted” you mean accepted by some scientists, it isn't [5].";
const names = ["Qwen 3.8 27B", "GPT OSS 20B", "Nemotron 3.5 Lightning"];

test("a reply is cut where the model starts writing another agent's turn", () => {
  const cut = cutAtAnotherTurn(QWEN_REPLY, names);
  assert.ok(cut.endsWith("Confidence: 99%."), cut);
  assert.ok(!cut.includes("Nemotron"));
});

test("the card shows the cut reply too", () => {
  assert.ok(!splitCot(QWEN_REPLY, names).answer.includes("[Nemotron 3.5 Lightning]"));
});

test("brackets that are not an agent's name are left alone", () => {
  for (const text of [
    "See the docs.\n[1]: https://example.com/reference",
    "A script:\n[Alice]: Hello.\n[Bob]: Hi.",
    "Compare them:\nClaude: long context.\nGPT: wide tooling.",
  ]) {
    assert.equal(cutAtAnotherTurn(text, names), text);
  }
});

test("a turn label still arriving at the end of the stream is hidden, not flashed", () => {
  assert.equal(cutAtAnotherTurn("Done.\n\n[Nemotron 3.5 Li", names), "Done.");
  assert.equal(cutAtAnotherTurn("Done.\n\n[Note", names), "Done.\n\n[Note", "not the start of any agent's label");
});

test("sources keep the numbers the prose cites", () => {
  const sources = [1, 2, 3, 4, 5].map((i) => ({ url: `https://example.com/${i}` }));
  const { answer, citations } = pruneUnusedSources(QWEN_REPLY, sources);
  assert.equal(answer, QWEN_REPLY, "the prose is shown as it streamed, so it must not be renumbered");
  assert.deepEqual(
    citations.map((c) => [c.n, c.url]),
    [
      [4, "https://example.com/4"],
      [5, "https://example.com/5"],
    ]
  );
  // And the next agent in the relay reads them under those same numbers.
  const msgs = buildMessages([], "Q", [{ agentName: "Qwen", content: answer, citations }]);
  assert.match(String(msgs[msgs.length - 2].content), /\[4\] https:\/\/example\.com\/4/);
});

/* ---------- the whole relay, against a stand-in model server ---------- */

let server: http.Server;
let baseUrl = "";
const requests: { model: string; messages: { role: string; content: unknown }[] }[] = [];

before(async () => {
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      if (!req.url?.endsWith("/chat/completions")) {
        res.writeHead(404).end();
        return;
      }
      const parsed = JSON.parse(body);
      requests.push(parsed);
      const text = parsed.model === "qwen" ? QWEN_REPLY : "Natural selection lacked a mechanism of inheritance.";
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\n`);
      res.end("data: [DONE]\n\n");
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
});
after(() => server.close());

test("in a relay, the second agent is told which question to answer, and never sees the impersonated turn", async () => {
  const events: { type: string; data: any }[] = [];
  const agent = (id: string, name: string, model: string) => ({
    id,
    name,
    model,
    provider: "lmstudio",
    baseUrl,
    role: "researcher",
  });
  await runConversation(
    {
      userMessage: "Why did the theory of evolution by natural selection get PARTIALLY accepted?",
      history: [
        { role: "user", content: "What is peptidoglycan?" },
        { role: "assistant", agentName: "Qwen 3.8 27B", content: "A polymer of the bacterial cell wall." },
        { role: "assistant", agentName: "Nemotron 3.5 Lightning", content: "A mesh of sugars and peptides." },
      ],
      agents: [agent("q", "Qwen 3.8 27B", "qwen"), agent("g", "GPT OSS 20B", "gpt-oss")],
      settings: { mode: "professional", detailedCoT: false, maxOutputTokens: 256, sessionOutputBudget: 0, parallel: false },
    } as Parameters<typeof runConversation>[0],
    { send: (type: string, data: unknown) => events.push({ type, data }), end() {}, onClose() {} } as any
  );

  const errors = events.filter((e) => e.type === "agent-error").map((e) => e.data.message);
  assert.deepEqual(errors, []);
  const second = requests.find((r) => r.model === "gpt-oss");
  assert.ok(second, "the second agent was never called");

  const last = second.messages[second.messages.length - 1];
  assert.equal(last.role, "user");
  assert.match(String(last.content), /PARTIALLY accepted/, "the closing instruction must name the current question");

  const seen = second.messages.map((m) => String(m.content)).join("\n");
  assert.ok(seen.includes("Confidence: 99%."), "Qwen's real answer reaches the next agent");
  assert.ok(!seen.includes("If by “partially accepted”"), "the turn Qwen wrote as someone else does not");
});

test("the server strips a bare speaker label with spaces around it, as the app does", async () => {
  const { stripSpeakerLabel } = await import("../core/src/index.ts");
  // Its pattern was written with \s inside a template string, which is just
  // "s": it matched only when nothing stood before the name or the colon.
  assert.equal(stripSpeakerLabel("  GPT OSS 20B : The answer.", names), "The answer.");
  assert.equal(stripSpeakerLabel("Note: this stays", names), "Note: this stays");
});

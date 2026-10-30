/**
 * A provider that never answers (2026-10-30). GPT OSS 20B, second in a relay,
 * sat on "starting…" past two and a half minutes with nothing back, and would
 * have sat there for good: Melon had no limit on how long it waited. In a
 * relay, every agent after it waited too.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { Socket } from "node:net";
import type { AddressInfo } from "node:net";
import { runConversation } from "../core/src/index.ts";
import { STALL_LIMITS } from "../core/src/orchestrator.ts";

let server: http.Server;
let baseUrl = "";
const sockets = new Set<Socket>();

const chunk = (text: string) => `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`;
const finish = `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`;

before(async () => {
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const { model } = JSON.parse(body || "{}");
      if (model === "silent") return; // Accepts the request, then says nothing at all.
      res.writeHead(200, { "content-type": "text/event-stream" });
      if (model === "queued") {
        // Busy, but alive: keep-alive comments for well past the limit, then the answer.
        let n = 0;
        const timer = setInterval(() => {
          res.write(": PROCESSING\n\n");
          if (++n === 8) {
            clearInterval(timer);
            res.end(chunk("Worth the wait.") + finish);
          }
        }, 100);
        return;
      }
      res.end(chunk("A prompt answer.") + finish);
    });
  });
  server.on("connection", (s) => {
    sockets.add(s);
    s.on("close", () => sockets.delete(s));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  // The stand-in is on this machine, so it is held to the local limit.
  STALL_LIMITS.localMs = 300;
  STALL_LIMITS.hostedMs = 300;
});
after(() => {
  for (const s of sockets) s.destroy();
  server.close();
});

async function relay(models: string[]) {
  const events: { type: string; data: any }[] = [];
  await runConversation(
    {
      userMessage: "Hello?",
      history: [],
      agents: models.map((m) => ({ id: m, name: m, model: m, provider: "lmstudio", baseUrl, role: "generalist" })),
      settings: { mode: "professional", detailedCoT: false, maxOutputTokens: 64, sessionOutputBudget: 0, parallel: false },
    } as Parameters<typeof runConversation>[0],
    { send: (type: string, data: unknown) => events.push({ type, data }), end() {}, onClose() {} } as any
  );
  return events;
}

test("a provider that never answers fails that agent with a reason, and the relay carries on", async () => {
  const events = await relay(["silent", "prompt"]);
  const error = events.find((e) => e.type === "agent-error" && e.data.agentId === "silent");
  assert.ok(error, "the silent agent was never given up on");
  assert.match(error.data.message, /sent nothing for/);
  assert.ok(
    events.some((e) => e.type === "agent-done" && e.data.agentId === "prompt"),
    "the agent after it never ran"
  );
});

test("a provider that is slow but sending keep-alives is not cut off", async () => {
  const events = await relay(["queued"]);
  assert.deepEqual(
    events.filter((e) => e.type === "agent-error").map((e) => e.data.message),
    [],
    "keep-alives must count as the provider being alive"
  );
  const text = events
    .filter((e) => e.type === "token" && e.data.agentId === "queued")
    .map((e) => e.data.text)
    .join("");
  assert.equal(text, "Worth the wait.");
});

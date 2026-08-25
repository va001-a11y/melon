import type { Request, Response } from "express";

/**
 * Built-in demo provider: an OpenAI-compatible streaming endpoint served by
 * this server, so the platform can be smoke-tested with zero API keys.
 * Add an agent with provider "OpenAI / compatible" and base URL
 * http://localhost:5175/api/demo/v1 — any model id works.
 */
export function demoChatCompletions(req: Request, res: Response): void {
  const model = (req.body?.model as string) ?? "demo";
  const lastUser = Array.isArray(req.body?.messages)
    ? [...req.body.messages].reverse().find((m: { role: string }) => m.role === "user")
    : undefined;
  const question = typeof lastUser?.content === "string" ? lastUser.content.slice(0, 120) : "(no message)";

  res.setHeader("content-type", "text/event-stream");
  res.flushHeaders();

  const text =
    `===REASONING===\nStep 1: I read the request: "${question}". ` +
    `Assumption: this is a demo run, so the goal is to exercise streaming, CoT parsing, and parallel display. ` +
    `Check performed: request body contained ${req.body?.messages?.length ?? 0} messages. ` +
    `Alternative considered: replying instantly — rejected, because slow streaming demonstrates STOP TOKEN FLOW.\n` +
    `===ANSWER===\nHello! I am the built-in demo model ("${model}"). ` +
    `This response is streamed chunk by chunk through the unified provider layer, ` +
    `so you can watch parallel agents, expand my Detailed CoT above, or hit STOP TOKEN FLOW mid-stream. ` +
    `Everything you see works identically with real providers once you add keys.`;

  const chunks = text.match(/.{1,14}/gs) ?? [];
  let i = 0;
  const timer = setInterval(() => {
    if (res.writableEnded) {
      clearInterval(timer);
      return;
    }
    if (i >= chunks.length) {
      res.write(
        `data: ${JSON.stringify({
          choices: [{ delta: {} }],
          usage: { prompt_tokens: 40 + (req.body?.messages?.length ?? 0) * 20, completion_tokens: chunks.length },
        })}\n\n`
      );
      res.write("data: [DONE]\n\n");
      res.end();
      clearInterval(timer);
      return;
    }
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: chunks[i] } }] })}\n\n`);
    i++;
  }, 90);
  res.on("close", () => clearInterval(timer));
}

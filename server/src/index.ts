import express from "express";
import { execFile } from "node:child_process";
import type { AgentSpec, RunRequest } from "./types.js";
import { PROVIDERS } from "./catalog.js";
import { resolveTarget } from "./providers/index.js";
import { runConversation } from "./orchestrator.js";
import { stopController } from "./stop.js";
import { COMPAT_PROVIDERS, HARD_AGENT_CAP, MODEL_REGISTRY, RECOMMENDED_AGENTS } from "./registry.js";
import { extractPdf } from "./files.js";
import { listModels } from "./models.js";
import { analytics } from "./analytics.js";
import { BUNDLES } from "./marketplace.js";
import { demoChatCompletions } from "./demo.js";
import { tokenGuard } from "./guard.js";

// Deliberately not process.env.PORT: dev launchers set PORT for the
// front-end and would collide the API server onto Vite's port.
const PORT = Number(process.env.VEDAI_SERVER_PORT ?? 5175);
const app = express();
// Attachments are base64 in the body, so this has to be generous: a 4 MB
// file is ~5.5 MB encoded, and several can be sent at once.
app.use(express.json({ limit: "40mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, activeRuns: stopController.activeRunCount() });
});

app.get("/api/guard", (_req, res) => {
  res.json({
    session: tokenGuard.sessionUsage(),
    budget: tokenGuard.getBudget(),
    remainingFraction: tokenGuard.remainingFraction(),
  });
});

app.post("/api/guard/reset", (_req, res) => {
  tokenGuard.reset();
  res.json({ session: tokenGuard.sessionUsage() });
});

app.get("/api/registry", (_req, res) => {
  res.json({
    providers: PROVIDERS,
    models: MODEL_REGISTRY,
    endpoints: COMPAT_PROVIDERS,
    hardCap: HARD_AGENT_CAP,
    recommended: RECOMMENDED_AGENTS,
  });
});

app.post("/api/extract-pdf", extractPdf);

/** Ask a provider which models it currently serves. */
app.post("/api/list-models", listModels);

/**
 * Probe the machine for local model runtimes and report what is actually
 * there. Turns "could not connect" into a list of what IS reachable and
 * which models are installed.
 */
app.get("/api/detect-local", async (_req, res) => {
  // OLLAMA_HOST relocates Ollama; honour it before falling back to the default.
  const envHost = process.env.OLLAMA_HOST?.trim();
  const ollamaHosts = ["127.0.0.1", "localhost"];
  let ollamaPort = 11434;
  if (envHost) {
    try {
      const parsed = new URL(envHost.includes("://") ? envHost : `http://${envHost}`);
      if (parsed.hostname) ollamaHosts.unshift(parsed.hostname);
      if (parsed.port) ollamaPort = Number(parsed.port);
    } catch {
      /* malformed OLLAMA_HOST — reported in the diagnosis below */
    }
  }

  const targets = [
    { id: "ollama", label: "Ollama", hosts: ollamaHosts, port: ollamaPort, path: "/api/tags" },
    { id: "lmstudio", label: "LM Studio", hosts: ["127.0.0.1", "localhost"], port: 1234, path: "/v1/models" },
    { id: "llamacpp", label: "llama.cpp / vLLM", hosts: ["127.0.0.1", "localhost"], port: 8080, path: "/v1/models" },
  ];

  const results = await Promise.all(
    targets.map(async (t) => {
      for (const host of t.hosts) {
        const base = `http://${host}:${t.port}`;
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 2500);
          const probe = await fetch(base + t.path, { signal: controller.signal });
          clearTimeout(timer);
          if (!probe.ok) continue;
          const data: any = await probe.json();
          const models: string[] = Array.isArray(data?.models)
            ? data.models.map((m: any) => m.name ?? m.model).filter(Boolean)
            : Array.isArray(data?.data)
              ? data.data.map((m: any) => m.id).filter(Boolean)
              : [];
          return { id: t.id, label: t.label, found: true, baseUrl: base, models };
        } catch {
          /* try the next host */
        }
      }
      return { id: t.id, label: t.label, found: false, baseUrl: `http://${t.hosts[0]}:${t.port}`, models: [] };
    })
  );

  // If Ollama isn't answering, work out how far the user actually got.
  let diagnosis: string | null = null;
  const ollama = results.find((r) => r.id === "ollama");
  if (ollama && !ollama.found) {
    const version = await new Promise<string | null>((resolve) => {
      execFile("ollama", ["--version"], { timeout: 4000, windowsHide: true }, (err, stdout) => {
        resolve(err ? null : stdout.trim());
      });
    });
    if (!version) {
      diagnosis =
        "The `ollama` command was not found, so Ollama is probably not installed (or not on PATH). Install it from ollama.com and restart Melon.";
    } else if (envHost) {
      diagnosis = `Ollama ${version} is installed, and OLLAMA_HOST is set to "${envHost}" — but nothing answered there. Start it with \`ollama serve\`, or clear OLLAMA_HOST if that address is wrong.`;
    } else {
      diagnosis = `Ollama ${version} is installed but nothing is listening on port ${ollamaPort}. The background service isn't running — start the Ollama app, or run \`ollama serve\` in a terminal and leave it open.`;
    }
  }

  res.json({ runtimes: results, diagnosis, ollamaHost: envHost ?? null });
});

/** Send one tiny message to check an agent's provider/model/key really work. */
app.post("/api/test-agent", async (req, res) => {
  const agent = req.body as AgentSpec;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const target = resolveTarget(agent);
    if (target.needsKey && !agent.apiKey?.trim()) {
      res.json({ ok: false, message: `${target.label} needs an API key.` });
      return;
    }
    let got = "";
    await target.adapter.chat({
      model: agent.model,
      apiKey: agent.apiKey,
      baseUrl: target.baseUrl,
      providerLabel: target.label,
      system: "Reply with the single word: ok",
      messages: [{ role: "user", content: "Say ok." }],
      maxOutputTokens: 16,
      signal: controller.signal,
      handlers: {
        onToken: (t) => {
          got += t;
        },
      },
    });
    res.json({
      ok: true,
      message: `${target.label} responded${got.trim() ? `: “${got.trim().slice(0, 60)}”` : "."}`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.json({ ok: false, message: controller.signal.aborted ? "Timed out after 20s." : message });
  } finally {
    clearTimeout(timer);
  }
});

app.get("/api/analytics", (_req, res) => {
  res.json(analytics.snapshot());
});

app.post("/api/analytics/reset", (_req, res) => {
  analytics.reset();
  res.json({ ok: true });
});

// User-reported inaccuracy for a specific model's response.
app.post("/api/analytics/flag", (req, res) => {
  const provider = typeof req.body?.provider === "string" ? req.body.provider : "";
  const model = typeof req.body?.model === "string" ? req.body.model : "";
  if (!provider || !model) {
    res.status(400).json({ error: "provider and model are required" });
    return;
  }
  analytics.recordFlag(provider, model);
  res.json({ ok: true });
});

app.get("/api/marketplace", (_req, res) => {
  res.json({ bundles: BUNDLES });
});

// Keyless demo provider (OpenAI-compatible) for smoke-testing the platform.
app.post("/api/demo/v1/chat/completions", demoChatCompletions);

// The demo provider answers /models too, so Fetch behaves like a real one.
app.get("/api/demo/v1/models", (_req, res) => {
  res.json({
    data: [
      { id: "demo-researcher" },
      { id: "demo-writer" },
      { id: "demo-critic" },
      { id: "demo-simplifier" },
    ],
  });
});

app.post("/api/run", (req, res) => {
  res.setHeader("content-type", "text/event-stream");
  res.setHeader("cache-control", "no-cache");
  res.setHeader("connection", "keep-alive");
  res.flushHeaders();
  void runConversation(req.body as RunRequest, res);
});

// STOP TOKEN FLOW — global circuit breaker. Terminal by design: aborted
// generations are gone for good; there is no resume.
app.post("/api/stop", (_req, res) => {
  const aborted = stopController.stopAll();
  res.json({ abortedRuns: aborted });
});

/**
 * Start listening, retrying briefly on EADDRINUSE. During hot-reload the
 * previous process is often still releasing the port, so a few short retries
 * avoid a spurious failure. A genuine clash still ends with a clear message
 * rather than a stack trace.
 */
function start(attempt = 1): void {
  // Bind to 127.0.0.1 explicitly rather than every interface: it keeps the
  // server off the local network, and matches the address the client proxies
  // to, avoiding the IPv4/IPv6 "localhost" mismatch on Windows.
  const server = app.listen(PORT, "127.0.0.1", () => {
    console.log(`Melon server listening on http://127.0.0.1:${PORT}`);
  });

  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE" && attempt < 6) {
      setTimeout(() => start(attempt + 1), 500);
      return;
    }
    if (err.code === "EADDRINUSE") {
      console.error(
        `\n  Port ${PORT} is already in use.\n` +
          `  Melon may already be running — check http://localhost:5173\n` +
          `  Otherwise close the other program, or use a different port:\n` +
          `      set VEDAI_SERVER_PORT=5180 && npm run dev\n`
      );
    } else {
      console.error("Melon server failed to start:", err.message);
    }
    process.exit(1);
  });
}

start();

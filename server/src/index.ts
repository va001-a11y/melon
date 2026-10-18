import express from "express";
import { sseSink } from "./sse.js";
import type { AgentSpec, RunRequest } from "@melon/core";
import { BUNDLES, COMPAT_PROVIDERS, HARD_AGENT_CAP, MODEL_REGISTRY, PROVIDERS, RECOMMENDED_AGENTS, analytics, resolveTarget, runConversation, stopController, tokenGuard } from "@melon/core";
import { execFile } from "node:child_process";
import { isIP } from "node:net";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { listModels, testAgent } from "./models.js";

// Deliberately not process.env.PORT: dev launchers set PORT for the
// front-end and would collide the API server onto Vite's port.
const PORT = Number(process.env.MELON_SERVER_PORT ?? 5175);
/*
 * Which address to listen on. 127.0.0.1 keeps Melon off the local network,
 * which is the right default on a desktop. It is the wrong one inside a
 * container, where loopback belongs to the container alone and a published
 * port would still reach nothing — so the image sets MELON_BIND=0.0.0.0 and
 * lets `docker run -p` decide who can actually connect.
 */
const BIND = process.env.MELON_BIND ?? "127.0.0.1";
const app = express();
// Attachments are base64 in the body, so this has to be generous: a 4 MB
// file is ~5.5 MB encoded, and several can be sent at once.
/*
 * DNS rebinding. Binding to 127.0.0.1 keeps other machines out, but not other
 * websites: an attacker's domain can be made to resolve to 127.0.0.1 after the
 * page loads, at which point the browser treats Melon as same-origin with it
 * and lets it read every response. The one thing that gives it away is the
 * Host header, which still carries the attacker's domain.
 *
 * So a request is accepted only when Host is localhost or a bare IP address.
 * Rebinding needs a domain name to work, so IPs are safe to allow -- which
 * keeps Melon reachable at http://192.168.1.20:8080 from a phone on the same
 * network. Anyone putting it behind a reverse proxy with its own name adds
 * that name to MELON_ALLOWED_HOSTS. Vite applies the same rule to its own
 * dev server for the same reason.
 */
const EXTRA_HOSTS = (process.env.MELON_ALLOWED_HOSTS ?? "")
  .split(",")
  .map((h) => h.trim().toLowerCase())
  .filter(Boolean);

function hostAllowed(header: string | undefined): boolean {
  if (!header) return false;
  let host = header.trim().toLowerCase();
  // IPv6 literals arrive bracketed, port and all: [::1]:5175
  host = host.startsWith("[") ? host.slice(1, host.indexOf("]")) : host.split(":")[0];
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (isIP(host)) return true;
  return EXTRA_HOSTS.includes(host);
}

app.use((req, res, next) => {
  if (hostAllowed(req.headers.host)) {
    next();
    return;
  }
  res
    .status(403)
    .type("text/plain")
    .send(
      `Melon refused a request addressed to "${req.headers.host ?? ""}".` + "\n\n" +
        "If you are reaching Melon through a reverse proxy or a hostname of your own, add that name to " +
        "MELON_ALLOWED_HOSTS (comma-separated) and restart it. Requests to localhost or to an IP " +
        "address are always accepted.\n"
    );
});

/*
 * Cross-site requests. A plain POST counts as a CORS "simple request", so any
 * page you visit could send one to Melon without asking -- stop every run,
 * reset the spending guard, or start a conversation on your keys. Melon's own
 * client sends this header on every POST. A cross-site page cannot add it
 * without a preflight, and Melon answers no preflights, so the browser never
 * sends those requests at all.
 */
app.use("/api", (req, res, next) => {
  if (req.method !== "POST" || req.get("x-melon") === "1") {
    next();
    return;
  }
  res.status(403).json({ error: "Missing the X-Melon header that Melon's own client sends." });
});

app.use(express.json({ limit: "40mb" }));

/**
 * Express 4 does not catch a rejected promise from an async handler. The
 * rejection escapes, Node treats it as unhandled, and the whole server exits
 * -- taking every running conversation with it over one bad request. This
 * turns it into an ordinary 500 instead.
 */
type Handler = (req: express.Request, res: express.Response) => Promise<void>;
function safe(fn: Handler): express.RequestHandler {
  return (req, res) => {
    fn(req, res).catch((err: unknown) => {
      console.error("Melon: request failed:", err);
      if (!res.headersSent) res.status(500).json({ error: "Melon could not handle that request." });
      else res.end();
    });
  };
}

/**
 * The minimum shape runConversation needs before it touches anything. Without
 * it, a body that is not JSON -- `Content-Type: text/plain` leaves req.body as
 * {} -- reached `req.agents.length`, threw inside a discarded promise, and
 * ended the process. That request is one any web page can send with no CORS
 * preflight, so it was a remote off-switch for Melon.
 */
function isRunRequest(body: unknown): body is RunRequest {
  if (!body || typeof body !== "object") return false;
  const b = body as Record<string, unknown>;
  return (
    typeof b.userMessage === "string" &&
    Array.isArray(b.history) &&
    Array.isArray(b.agents) &&
    b.agents.every((a) => a !== null && typeof a === "object") &&
    b.settings !== null &&
    typeof b.settings === "object"
  );
}

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

/*
 * /api/extract-pdf is gone. PDFs are read in the browser now (client/src/pdf.ts),
 * which removes a multi-megabyte base64 round trip through this process and
 * means the hosted build handles them too.
 */

/** Ask a provider which models it currently serves. */
app.post("/api/list-models", safe(listModels));

/**
 * Probe the machine for local model runtimes and report what is actually
 * there. Turns "could not connect" into a list of what IS reachable and
 * which models are installed.
 */
app.get("/api/detect-local", safe(async (_req, res) => {
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
}));

/** Send one tiny message to check an agent's provider/model/key really work. */
app.post("/api/test-agent", safe(testAgent));

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

/*
 * The keyless demo provider used to be served from here as an
 * OpenAI-compatible endpoint. It is now a real adapter in @melon/core
 * (providers/demo.ts) that generates its stream in-process, so it works
 * without a server at all — and both builds run the same code rather than
 * one going over HTTP and the other not.
 */

app.post("/api/run", (req, res) => {
  // Checked before the stream opens, so a bad request gets a real 400 rather
  // than an event stream that dies on its first line.
  if (!isRunRequest(req.body)) {
    res.status(400).json({ error: "That is not a valid conversation request." });
    return;
  }
  res.setHeader("content-type", "text/event-stream");
  res.setHeader("cache-control", "no-cache");
  res.setHeader("connection", "keep-alive");
  res.flushHeaders();
  const sink = sseSink(res);
  runConversation(req.body, sink).catch((err: unknown) => {
    console.error("Melon: a run failed:", err);
    sink.send("error", { message: "Something went wrong on Melon's side, and this reply was stopped." });
    sink.end();
  });
});

// STOP TOKEN FLOW — global circuit breaker. Terminal by design: aborted
// generations are gone for good; there is no resume.
app.post("/api/stop", (_req, res) => {
  const aborted = stopController.stopAll();
  res.json({ abortedRuns: aborted });
});

/*
 * Serve the built UI when it is present, so one process is the whole app.
 * The desktop flow never needs this (Vite serves the client on its own port
 * and proxies /api here), but a container publishes a single port, and the
 * client only ever calls /api/... relatively — so serving both from here
 * works without the client knowing anything has changed.
 */
const CLIENT_DIST = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "client", "dist");
if (existsSync(join(CLIENT_DIST, "index.html"))) {
  app.use(express.static(CLIENT_DIST));
  // Single-page app: a deep link is still index.html. API paths must fall
  // through to Express's own 404 instead, or a mistyped endpoint would
  // answer with HTML and surface as an unreadable JSON parse error.
  app.use((req, res, next) => {
    if (req.method !== "GET" || req.path.startsWith("/api/")) {
      next();
      return;
    }
    res.sendFile(join(CLIENT_DIST, "index.html"));
  });
}

/**
 * Start listening, retrying briefly on EADDRINUSE. During hot-reload the
 * previous process is often still releasing the port, so a few short retries
 * avoid a spurious failure. A genuine clash still ends with a clear message
 * rather than a stack trace.
 */
/*
 * The last line of defence. Since Node 15 an unhandled rejection ends the
 * process, which turns any forgotten await anywhere into a way to stop
 * Melon. Logging it keeps the server up and leaves the bug visible.
 *
 * Deliberately not uncaughtException: after a synchronous throw the process
 * may be in a state nobody can reason about, and carrying on is worse than
 * stopping.
 */
process.on("unhandledRejection", (reason) => {
  console.error("Melon: caught an unhandled error and kept running:", reason);
});

function start(attempt = 1): void {
  // Bind to 127.0.0.1 explicitly rather than every interface: it keeps the
  // server off the local network, and matches the address the client proxies
  // to, avoiding the IPv4/IPv6 "localhost" mismatch on Windows.
  const server = app.listen(PORT, BIND, () => {
    console.log(`Melon server listening on http://${BIND}:${PORT}`);
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
          `      set MELON_SERVER_PORT=5180 && npm run dev\n`
      );
    } else {
      console.error("Melon server failed to start:", err.message);
    }
    process.exit(1);
  });
}

start();

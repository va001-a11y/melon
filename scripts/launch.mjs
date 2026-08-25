#!/usr/bin/env node
/**
 * Melon launcher — one implementation for Windows, macOS and Linux.
 *
 * The .bat and .sh wrappers are two lines each; everything real happens here,
 * in Node, which every Melon install already has. That keeps the three
 * platforms from drifting apart.
 *
 * It: clears processes left over from a previous run, picks ports that are
 * genuinely free on this machine, starts the dev servers, and opens the app
 * in whatever browser the user has set as their default.
 */
import { spawn, execFile } from "node:child_process";
import { createServer } from "node:net";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { platform } from "node:os";

const PLATFORM_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const OS = platform();
const IS_WINDOWS = OS === "win32";

function say(line = "") {
  console.log(line);
}

/** The Windows command interpreter, from the environment rather than PATH. */
const COMSPEC = process.env.ComSpec || "C:\\Windows\\System32\\cmd.exe";

/**
 * Spawn an npm command portably.
 *
 * Windows refuses to spawn npm.cmd directly — it throws EINVAL, because since
 * Node 18.20 a .cmd file needs a shell. Passing `shell: true` alongside an
 * args array is deprecated (args get concatenated unescaped), so the safe
 * route is to invoke the command interpreter explicitly.
 */
function spawnNpm(args, extraEnv = {}) {
  const cmd = IS_WINDOWS ? COMSPEC : "npm";
  const argv = IS_WINDOWS ? ["/c", "npm", ...args] : args;
  try {
    const child = spawn(cmd, argv, {
      cwd: PLATFORM_DIR,
      stdio: "inherit",
      windowsHide: true,
      env: { ...process.env, ...extraEnv },
    });
    child.on("error", (err) => failSpawn(err, args));
    return child;
  } catch (err) {
    failSpawn(err, args);
    return null;
  }
}

/** Turn a spawn failure into something a person can act on. */
function failSpawn(err, args) {
  say();
  say(`  [X] Could not run "npm ${args.join(" ")}".`);
  if (err?.code === "ENOENT") {
    say("      npm was not found. Node.js installs it — reinstall Node from https://nodejs.org");
  } else if (err?.code === "EINVAL") {
    say("      Windows refused to start npm. This usually means an outdated copy of");
    say("      launch.mjs; re-copy the platform folder from the original machine.");
  } else {
    say(`      ${err?.message ?? err}`);
  }
  say();
  process.exit(1);
}

/** Resolve when the port is free, reject when something already holds it. */
function isPortFree(port) {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once("error", () => resolve(false));
    probe.once("listening", () => probe.close(() => resolve(true)));
    // 127.0.0.1 specifically: that is the address Melon actually binds.
    probe.listen(port, "127.0.0.1");
  });
}

async function findFreePort(start) {
  for (let port = start; port < start + 60; port++) {
    if (await isPortFree(port)) return port;
  }
  return start;
}

/**
 * Where the last-used ports are remembered.
 *
 * This matters more than it looks: the browser scopes saved data (chats,
 * agents, keys, settings) to the exact origin, and the origin includes the
 * port. Coming back on a different port would present a blank Melon with
 * everything apparently gone. So we reuse the previous port whenever it is
 * still free, and only move when something else genuinely holds it.
 */
const PORTS_FILE = join(PLATFORM_DIR, ".melon-ports.json");

function readRememberedPorts() {
  try {
    const saved = JSON.parse(readFileSync(PORTS_FILE, "utf8"));
    if (Number.isInteger(saved?.clientPort) && Number.isInteger(saved?.serverPort)) return saved;
  } catch {
    /* first run, or the file was removed */
  }
  return null;
}

function rememberPorts(clientPort, serverPort) {
  try {
    writeFileSync(PORTS_FILE, JSON.stringify({ clientPort, serverPort }, null, 2));
  } catch {
    /* not being able to remember is not worth failing the launch over */
  }
}

/** Choose ports, preferring the ones the saved data already belongs to. */
async function choosePorts() {
  const remembered = readRememberedPorts();
  if (remembered && (await isPortFree(remembered.clientPort)) && (await isPortFree(remembered.serverPort))) {
    return { ...remembered, moved: false };
  }

  const clientPort = await findFreePort(5173);
  const serverPort = await findFreePort(Math.max(5175, clientPort + 1));
  const moved = remembered !== null && remembered.clientPort !== clientPort;
  return { clientPort, serverPort, moved, previousClientPort: remembered?.clientPort };
}

function run(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 10000, windowsHide: true }, (err, stdout) => {
      resolve(err ? "" : stdout);
    });
  });
}

/**
 * Close Melon processes from an earlier run.
 *
 * Matched on the command line containing THIS folder, never on port numbers:
 * another project may legitimately be using a port we once had, and killing
 * someone else's server would be unforgivable.
 */
async function clearStaleProcesses() {
  const pids = [];

  if (IS_WINDOWS) {
    const out = await run("powershell", [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | " +
        "Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress",
    ]);
    try {
      const parsed = JSON.parse(out || "[]");
      for (const p of Array.isArray(parsed) ? parsed : [parsed]) {
        if (!p?.CommandLine) continue;
        if (p.CommandLine.includes(PLATFORM_DIR) && /concurrently|tsx|vite|dist[\\/]index\.js/.test(p.CommandLine)) {
          if (p.ProcessId !== process.pid) pids.push(p.ProcessId);
        }
      }
    } catch {
      /* nothing parseable: skip cleanup rather than guess */
    }
  } else {
    // macOS and Linux: ps gives pid + full command in one go.
    const out = await run("/bin/sh", ["-c", "ps -eo pid=,command= 2>/dev/null"]);
    for (const line of out.split("\n")) {
      const match = line.trim().match(/^(\d+)\s+(.*)$/);
      if (!match) continue;
      const [, pid, cmd] = match;
      if (Number(pid) === process.pid) continue;
      if (cmd.includes(PLATFORM_DIR) && /concurrently|tsx|vite|dist\/index\.js/.test(cmd)) {
        pids.push(Number(pid));
      }
    }
  }

  let closed = 0;
  for (const pid of [...new Set(pids)]) {
    try {
      process.kill(pid, "SIGKILL");
      closed++;
    } catch {
      /* already gone */
    }
  }
  return closed;
}

/** Open a URL in the user's default browser, whichever one that is. */
function openBrowser(url) {
  // Failing to open a browser must never take the servers down with it —
  // the address is printed above, so the user can always click it.
  try {
    const child = IS_WINDOWS
      ? // "start" is a cmd builtin; the empty "" is the window title it expects.
        spawn(COMSPEC, ["/c", "start", "", url], { detached: true, stdio: "ignore", windowsHide: true })
      : spawn(OS === "darwin" ? "open" : "xdg-open", [url], { detached: true, stdio: "ignore" });
    child.on("error", () => say(`  (Could not open a browser automatically — open ${url} yourself.)`));
    child.unref();
  } catch {
    say(`  (Could not open a browser automatically — open ${url} yourself.)`);
  }
}

async function main() {
  say();
  say("  Melon - universal multi-model AI");
  say("  ================================");
  say();

  if (!existsSync(join(PLATFORM_DIR, "package.json"))) {
    say(`  [X] package.json not found in ${PLATFORM_DIR}`);
    process.exit(1);
  }
  say(`  Node ${process.version} on ${OS}.`);

  const closed = await clearStaleProcesses();
  if (closed > 0) say(`  Closed ${closed} leftover Melon process(es) from a previous run.`);

  if (!existsSync(join(PLATFORM_DIR, "node_modules"))) {
    say("  First run - installing dependencies. This takes a minute...");
    say();
    const install = spawnNpm(["install", "--no-fund", "--no-audit"]);
    const code = await new Promise((r) => install.on("close", r));
    if (code !== 0) {
      say();
      say("  [X] npm install failed. Scroll up for the reason.");
      process.exit(1);
    }
  }

  const { clientPort, serverPort, moved, previousClientPort } = await choosePorts();
  rememberPorts(clientPort, serverPort);

  if (moved) {
    // Saved data belongs to the old address, so say so plainly rather than
    // letting Melon look as though it has forgotten everything.
    say();
    say(`  Note: Melon usually runs on port ${previousClientPort}, but something else is using it,`);
    say(`  so this session is on ${clientPort}. Your chats and agents are saved against the old`);
    say(`  address, so this window will look empty. To get them back, close whatever is using`);
    say(`  port ${previousClientPort} and start Melon again.`);
    say();
  } else if (clientPort !== 5173) {
    say(`  Using port ${clientPort}.`);
  }

  const url = `http://127.0.0.1:${clientPort}`;
  say("  Starting servers...");
  say();
  say(`  Client : ${url}   (opening automatically)`);
  say(`  Server : http://127.0.0.1:${serverPort}`);
  say();
  say("  Press Ctrl+C to stop.");
  say();

  const dev = spawnNpm(["run", "dev"], {
    MELON_CLIENT_PORT: String(clientPort),
    MELON_SERVER_PORT: String(serverPort),
  });

  // Give Vite a moment to bind before the browser asks for the page.
  const opener = setTimeout(() => openBrowser(url), 5000);

  // Take the servers down with us, so we do not create the very leftovers
  // this launcher has to clean up next time.
  const shutdown = () => {
    clearTimeout(opener);
    if (!dev.killed) dev.kill();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  dev.on("close", (code) => {
    clearTimeout(opener);
    say();
    say("  Melon has stopped.");
    process.exit(code ?? 0);
  });
}

main();

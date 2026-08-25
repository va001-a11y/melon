#!/usr/bin/env node
/**
 * Build a shareable zip of Melon.
 *
 * Only source is included. node_modules is deliberately left out: it is ~99%
 * of the folder by size, and it holds binaries compiled for one operating
 * system (esbuild.exe, rollup-win32-x64.node), so copying it to a different
 * machine ranges from wasteful to broken. The receiving machine rebuilds it
 * with `npm install`, which the launcher does automatically on first run.
 */
import { cpSync, mkdtempSync, rmSync, existsSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir, platform } from "node:os";

const PLATFORM_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const IS_WINDOWS = platform() === "win32";

/** Everything needed to run Melon from a clean checkout. */
const INCLUDE = [
  "client/src",
  "client/index.html",
  "client/package.json",
  "client/tsconfig.json",
  "client/vite.config.ts",
  "server/src",
  "server/package.json",
  "server/tsconfig.json",
  "scripts",
  "package.json",
  "package-lock.json",
  "README.md",
  "LICENSE",
  // Shipped so an unzipped copy can seed a git repo without re-deriving it.
  ".gitignore",
  ".gitattributes",
  "Melon.bat",
  "melon.command",
];

function human(bytes) {
  return bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}

const stamp = new Date().toISOString().slice(0, 10);
const outName = `Melon-${stamp}.zip`;
const outPath = join(dirname(PLATFORM_DIR), outName);

const staging = mkdtempSync(join(tmpdir(), "melon-pkg-"));
const root = join(staging, "platform");

let copied = 0;
for (const rel of INCLUDE) {
  const from = join(PLATFORM_DIR, rel);
  if (!existsSync(from)) {
    console.log(`  skipped (missing): ${rel}`);
    continue;
  }
  cpSync(from, join(root, rel), { recursive: true });
  copied++;
}

if (existsSync(outPath)) rmSync(outPath);

try {
  if (IS_WINDOWS) {
    execFileSync(
      "powershell",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        `Compress-Archive -Path '${root}' -DestinationPath '${outPath}' -Force`,
      ],
      { stdio: "inherit" }
    );
  } else {
    // -r recurse, -q quiet; run from staging so paths inside stay relative.
    execFileSync("zip", ["-rq", outPath, "platform"], { cwd: staging, stdio: "inherit" });
  }
} catch (err) {
  console.error("\n  Could not create the zip:", err.message);
  console.error(`  The files are staged at ${root} — zip that folder yourself.`);
  process.exit(1);
} finally {
  if (existsSync(outPath)) rmSync(staging, { recursive: true, force: true });
}

console.log();
console.log(`  Created ${basename(outPath)}  (${human(statSync(outPath).size)}, ${copied} items)`);
console.log(`  ${outPath}`);
console.log();
console.log("  Send that one file. On the other computer:");
console.log("    1. Unzip it anywhere.");
console.log("    2. Run Melon.bat (Windows) or ./melon.command (macOS/Linux).");
console.log("    3. First run installs dependencies — needs internet, about a minute.");
console.log();
console.log("  Node.js must be installed there: https://nodejs.org (LTS).");
console.log("  API keys and chats live in the browser, so they do not travel with the zip.");

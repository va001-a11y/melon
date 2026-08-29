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
import { cpSync, mkdtempSync, rmSync, existsSync, statSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir, platform } from "node:os";

const PLATFORM_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const IS_WINDOWS = platform() === "win32";

/** Everything needed to run Melon from a clean checkout. */
const INCLUDE = [
  /*
   * Every workspace in package.json must appear here. When the core was
   * extracted, this list was not updated, so the zip declared a "core"
   * workspace it did not contain and npm install failed on it. The guard
   * below now checks that automatically rather than relying on memory.
   */
  "core/src",
  "core/package.json",
  "core/tsconfig.json",
  "client/src",
  "client/index.html",
  "client/package.json",
  "client/tsconfig.json",
  "client/vite.config.ts",
  // Selects the browser target for `npm run web`; a build switch, not a secret.
  "client/.env.web",
  "server/src",
  "server/package.json",
  "server/tsconfig.json",
  "scripts",
  "package.json",
  "package-lock.json",
  "README.md",
  "docs",
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

/*
 * Refuse to ship an archive that omits a workspace package.json declares.
 * The core was extracted into its own workspace and this list was not
 * updated, so every zip built afterwards declared a "core" workspace it did
 * not contain — npm install failed on it, and nothing noticed because the
 * packager reported success either way.
 */
const declaredWorkspaces = JSON.parse(readFileSync(join(PLATFORM_DIR, "package.json"), "utf8")).workspaces ?? [];
const missing = declaredWorkspaces.filter((w) => !INCLUDE.some((entry) => entry === w || entry.startsWith(`${w}/`)));
if (missing.length > 0) {
  console.error(
    `
  Refusing to package: package.json declares workspace(s) ${missing.join(", ")} ` +
      `which the INCLUDE list does not cover.
  Add them to scripts/package.mjs, or the zip will fail on npm install.
`
  );
  process.exit(1);
}

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

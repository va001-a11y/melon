#!/usr/bin/env node
/*
 * Check that a search engine returns results Melon can use, with your own
 * key -- before writing an adapter for a new engine, or to confirm one that
 * was built from documentation rather than tested with a real key.
 *
 * Covers Serper, Linkup, Exa, SerpAPI and Firecrawl, then reads one page
 * through Jina Reader, which needs no key at all. The request shapes here
 * mirror the adapters in core/src/search.ts; they are copied rather than
 * imported so this runs with plain `node`, with nothing to build first.
 *
 *     node scripts/probe-search.mjs
 *     node scripts/probe-search.mjs "your own query"
 *
 * It ASKS for each key rather than reading a command-line argument, and the
 * typing is hidden. That is deliberate: a key typed into a PowerShell or bash
 * command is saved to that shell's history file on disk, in plain text, for
 * good. Press Enter on an empty prompt to skip an engine.
 *
 * SERPER_API_KEY and LINKUP_API_KEY are read from the environment instead if
 * they are already set there.
 *
 * Nothing is saved, logged or sent anywhere but the engine itself, and any
 * echo of the key in an error message is blanked before it is printed.
 */
import readline from "node:readline";

const query = process.argv[2] || "What is the latest Node.js LTS release?";

/** Read a line without echoing it to the screen. */
function askHidden(question) {
  if (!process.stdin.isTTY) return Promise.resolve("");
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    // Print the question itself, but swallow every keystroke echoed after it.
    rl._writeToOutput = (text) => {
      if (text.includes(question)) process.stdout.write(text);
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer.trim());
    });
  });
}

const engines = [
  {
    name: "Serper",
    env: "SERPER_API_KEY",
    signup: "https://serper.dev",
    async search(key) {
      const res = await fetch("https://google.serper.dev/search", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": key },
        body: JSON.stringify({ q: query, num: 5 }),
        signal: AbortSignal.timeout(20000),
      });
      const data = await res.json().catch(() => null);
      const hits = (data?.organic ?? []).map((r) => ({ url: r.link, title: r.title, snippet: r.snippet }));
      return { res, data, hits, mapping: "url = organic[].link · title = organic[].title · snippet = organic[].snippet" };
    },
  },
  {
    name: "Exa",
    env: "EXA_API_KEY",
    signup: "https://exa.ai",
    async search(key) {
      const res = await fetch("https://api.exa.ai/search", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": key },
        body: JSON.stringify({ query, numResults: 5, contents: { text: { maxCharacters: 1500 } } }),
        signal: AbortSignal.timeout(30000),
      });
      const data = await res.json().catch(() => null);
      const hits = (data?.results ?? []).map((r) => ({ url: r.url, title: r.title, snippet: r.text }));
      return { res, data, hits, mapping: "url = results[].url · title = results[].title · snippet = results[].text" };
    },
  },
  {
    name: "SerpAPI",
    env: "SERPAPI_API_KEY",
    signup: "https://serpapi.com",
    async search(key) {
      const params = new URLSearchParams({ engine: "google", q: query, num: "5", api_key: key });
      const res = await fetch(`https://serpapi.com/search.json?${params}`, { signal: AbortSignal.timeout(30000) });
      const data = await res.json().catch(() => null);
      const hits = (data?.organic_results ?? []).map((r) => ({ url: r.link, title: r.title, snippet: r.snippet }));
      return { res, data, hits, mapping: "url = organic_results[].link · title = organic_results[].title · snippet = organic_results[].snippet" };
    },
  },
  {
    name: "Firecrawl",
    env: "FIRECRAWL_API_KEY",
    signup: "https://firecrawl.dev",
    async search(key) {
      const res = await fetch("https://api.firecrawl.dev/v2/search", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
        body: JSON.stringify({ query, limit: 5, scrapeOptions: { formats: [{ type: "markdown" }] } }),
        signal: AbortSignal.timeout(60000),
      });
      const data = await res.json().catch(() => null);
      const hits = (data?.data?.web ?? []).map((r) => ({ url: r.url, title: r.title, snippet: r.markdown || r.description }));
      return { res, data, hits, mapping: "url = data.web[].url · title = data.web[].title · snippet = data.web[].markdown (else .description)" };
    },
  },
  {
    name: "Linkup",
    env: "LINKUP_API_KEY",
    signup: "https://app.linkup.so",
    async search(key) {
      const res = await fetch("https://api.linkup.so/v1/search", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
        body: JSON.stringify({ q: query, depth: "standard", outputType: "searchResults" }),
        signal: AbortSignal.timeout(30000),
      });
      const data = await res.json().catch(() => null);
      const hits = (data?.results ?? [])
        .filter((r) => r.type === undefined || r.type === "text")
        .map((r) => ({ url: r.url, title: r.name, snippet: r.content }));
      return { res, data, hits, mapping: "url = results[].url · title = results[].name · snippet = results[].content" };
    },
  },
];

const isWeb = (u) => typeof u === "string" && /^https?:\/\//i.test(u.trim());
const clip = (s, n) => (s ?? "").replace(/\s+/g, " ").trim().slice(0, n);

console.log(`\nQuery: "${query}"\n`);

let tested = 0;
let failed = 0;

for (const engine of engines) {
  let key = process.env[engine.env]?.trim();
  if (!key) key = await askHidden(`${engine.name} API key (Enter to skip): `);
  if (!key) {
    console.log(`--- ${engine.name}: skipped (get a key at ${engine.signup})\n`);
    continue;
  }
  tested++;

  // If an API ever echoes the key back in an error, it does not reach the screen.
  const redact = (text) => String(text).split(key).join("[your key]");

  console.log(`--- ${engine.name} ---`);
  const t0 = Date.now();
  try {
    const { res, data, hits, mapping } = await engine.search(key);
    console.log(`status ${res.status} in ${Date.now() - t0}ms`);

    if (!res.ok) {
      failed++;
      console.log(`  FAILED: ${redact(clip(JSON.stringify(data), 300))}\n`);
      continue;
    }
    if (hits.length === 0) {
      failed++;
      // The response is not shaped as expected -- show it so the adapter can be fixed.
      console.log("  No results found in the expected place. The response looks like this:");
      console.log("  top-level fields:", Object.keys(data ?? {}).join(", "));
      console.log("  " + redact(clip(JSON.stringify(data), 600)) + "\n");
      continue;
    }

    const web = hits.filter((h) => isWeb(h.url)).length;
    const withTitle = hits.filter((h) => clip(h.title, 1)).length;
    const withSnippet = hits.filter((h) => clip(h.snippet, 1)).length;
    const avgSnippet = Math.round(hits.reduce((n, h) => n + (h.snippet ?? "").length, 0) / hits.length);

    console.log(`${hits.length} results`);
    hits.slice(0, 3).forEach((h, i) => {
      console.log(`  ${i + 1}. ${clip(h.title, 70)}`);
      console.log(`     ${clip(h.url, 90)}`);
      console.log(`     ${clip(h.snippet, 110)}…`);
    });
    console.log(`\n  What an adapter would read: ${mapping}`);
    console.log(`  Fields present: url ${web}/${hits.length} (http/https)  title ${withTitle}/${hits.length}  snippet ${withSnippet}/${hits.length}`);
    console.log(`  Average snippet: ${avgSnippet} characters (Melon keeps up to 1,500 per result)\n`);
    if (web < hits.length) failed++;
  } catch (e) {
    failed++;
    console.log(`  FAILED: ${redact(e.cause?.code ?? e.message)}\n`);
  }
}

/*
 * exitCode, not process.exit(). Exiting abruptly while fetch's sockets are
 * still closing trips a libuv assertion on Windows ("Assertion failed ...
 * async.c") -- harmless, but it prints a C-level crash after a perfectly good
 * run. Setting the code and letting Node finish on its own avoids it.
 */
/*
 * Jina Reader needs no key, so it is always checked: it is what Read full
 * pages uses, and the question is simply whether it is reachable from here.
 */
console.log("--- Jina Reader (no key needed) ---");
try {
  const t0 = Date.now();
  const res = await fetch("https://r.jina.ai/", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ url: "https://nodejs.org/en/about/previous-releases" }),
    signal: AbortSignal.timeout(40000),
  });
  const data = await res.json().catch(() => null);
  const content = String(data?.data?.content ?? "");
  console.log(`status ${res.status} in ${Date.now() - t0}ms — read ${content.length} characters of page text`);
  console.log(content.length > 1000 ? "  Working: Read full pages will be able to use it.\n" : "  Something is off: very little text came back.\n");
} catch (e) {
  console.log(`  FAILED: ${e.cause?.code ?? e.message}\n`);
}

if (tested === 0) {
  console.log("No keys given, so no search engine was tested.");
  process.exitCode = 1;
} else {
  console.log(failed === 0 ? "Every engine tested returned usable results." : `${failed} of ${tested} had a problem — see above.`);
  process.exitCode = failed === 0 ? 0 : 1;
}

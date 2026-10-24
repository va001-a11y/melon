/**
 * The web search engines. Each adapter is checked against the request and
 * response shapes its API really uses — Serper and Linkup confirmed with real
 * keys while being built, Exa, SerpAPI and Firecrawl confirmed afterwards —
 * so a refactor that drifts from them fails here rather than for a user.
 *
 * No network: fetch is replaced with a stand-in that records the request and
 * answers in the engine's own format.
 */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { runWebSearch, SEARCH_PROVIDERS } from "../core/src/search.ts";
import { isWebUrl } from "../client/src/secrets.ts";

interface Captured {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: Record<string, any> | null;
}
let req: Captured;

function respond(status: number, payload: unknown) {
  globalThis.fetch = (async (url: string | URL, init: RequestInit = {}) => {
    req = {
      url: String(url),
      method: init.method ?? "GET",
      headers: (init.headers ?? {}) as Record<string, string>,
      body: init.body ? JSON.parse(String(init.body)) : null,
    };
    return new Response(typeof payload === "string" ? payload : JSON.stringify(payload), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
}

const KEY = "TEST-KEY-123";
const search = (provider: string, maxResults = 3) =>
  runWebSearch({ provider, apiKey: KEY, query: "node lts", maxResults } as Parameters<typeof runWebSearch>[0]);

// A hostile link first in every list: filtering has to happen before the
// limit, or it uses up a slot that a real result should have had.
const evil = "javascript:alert(1)";

beforeEach(() => {
  req = undefined as unknown as Captured;
});

test("Serper: POST, key in a header, filters before the limit", async () => {
  respond(200, {
    organic: [
      { link: evil, title: "x", snippet: "x" },
      { link: "https://nodejs.org/a", title: "A", snippet: "sa" },
      { link: "https://nodejs.org/b", title: "B", snippet: "sb" },
      { link: "https://nodejs.org/c", title: "C", snippet: "sc" },
    ],
  });
  const hits = await search("serper");
  assert.equal(req.method, "POST");
  assert.equal(req.url, "https://google.serper.dev/search");
  assert.equal(req.headers["x-api-key"], KEY);
  assert.ok(!JSON.stringify(req.body).includes(KEY), "the key is not in the body");
  assert.deepEqual([req.body!.q, req.body!.num], ["node lts", 3]);
  assert.deepEqual(hits[0], { url: "https://nodejs.org/a", title: "A", snippet: "sa" });
  assert.equal(hits.length, 3);
});

test("Linkup: Bearer key, search results, skips images, applies the limit", async () => {
  respond(200, {
    results: [
      { type: "text", url: evil, name: "x", content: "x" },
      { type: "image", url: "https://img.test/p.png", name: "pic" },
      { type: "text", url: "https://a.test", name: "A", content: "long text a" },
      { type: "text", url: "https://b.test", name: "B", content: "long text b" },
      { type: "text", url: "https://c.test", name: "C", content: "long text c" },
      { type: "text", url: "https://d.test", name: "D", content: "long text d" },
    ],
  });
  const hits = await search("linkup");
  assert.equal(req.url, "https://api.linkup.so/v1/search");
  assert.equal(req.headers.authorization, `Bearer ${KEY}`);
  assert.deepEqual([req.body!.outputType, req.body!.depth, req.body!.q], ["searchResults", "standard", "node lts"]);
  assert.ok(!hits.some((h) => h.url.includes("img.test")));
  assert.equal(hits[0].title, "A");
  assert.equal(hits[0].snippet, "long text a");
  assert.equal(hits.length, 3);
});

test("Exa: key in a header, asks for page text capped at the snippet limit", async () => {
  respond(200, {
    results: [
      { url: evil, title: "x", text: "x" },
      { url: "https://e.test/1", title: "E1", text: "exa text" },
    ],
  });
  const hits = await search("exa");
  assert.equal(req.url, "https://api.exa.ai/search");
  assert.equal(req.headers["x-api-key"], KEY);
  assert.deepEqual([req.body!.query, req.body!.numResults], ["node lts", 3]);
  assert.equal(req.body!.contents?.text?.maxCharacters, 1500);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].snippet, "exa text");
});

test("SerpAPI: GET with everything as parameters", async () => {
  respond(200, { organic_results: [{ link: "https://s.test/1", title: "S1", snippet: "serp snippet" }] });
  const hits = await search("serpapi");
  const u = new URL(req.url);
  assert.equal(req.method, "GET");
  assert.equal(u.pathname, "/search.json");
  assert.equal(u.searchParams.get("engine"), "google");
  assert.equal(u.searchParams.get("q"), "node lts");
  assert.equal(u.searchParams.get("num"), "3");
  assert.equal(u.searchParams.get("api_key"), KEY);
  assert.equal(hits[0].snippet, "serp snippet");
});

test("Firecrawl: v2, reads data.web, prefers the whole page", async () => {
  respond(200, {
    success: true,
    data: {
      web: [
        { url: "https://f.test/1", title: "F1", description: "short", markdown: "# Full page\nall of it" },
        { url: "https://f.test/2", title: "F2", description: "only a description", markdown: null },
      ],
    },
  });
  const hits = await search("firecrawl");
  assert.equal(req.url, "https://api.firecrawl.dev/v2/search");
  assert.equal(req.headers.authorization, `Bearer ${KEY}`);
  assert.equal(req.body!.scrapeOptions?.formats?.[0]?.type, "markdown");
  assert.equal(req.body!.limit, 3);
  assert.equal(hits.length, 2);
  assert.ok(hits[0].snippet.startsWith("# Full page"));
  assert.equal(hits[0].fullPage, true);
  assert.equal(hits[1].snippet, "only a description");
});

for (const engine of ["tavily", "brave"]) {
  test(`${engine}: only web links survive, and all the real ones are kept`, async () => {
    const results = [
      { url: "https://good.example/one", title: "One", content: "first" },
      { url: "javascript:alert(document.cookie)", title: "Evil", content: "x" },
      { url: "https://good.example/two", title: "Two", content: "second" },
      { url: "  JavaScript:alert(1)", title: "Evil caps", content: "x" },
      { url: "data:text/html,<script>alert(1)</script>", title: "Data", content: "x" },
      { url: "http://good.example/three", title: "Three", content: "third" },
    ];
    respond(
      200,
      engine === "tavily" ? { results } : { web: { results: results.map((r) => ({ ...r, description: r.content })) } }
    );
    const hits = await search(engine);
    assert.deepEqual(
      hits.map((h) => h.url),
      ["https://good.example/one", "https://good.example/two", "http://good.example/three"]
    );
  });
}

test("an error that echoes the key shows it blanked out", async () => {
  respond(500, `upstream failed for https://serpapi.com/search.json?api_key=${KEY}&q=x`);
  await assert.rejects(search("serpapi"), (e: Error) => e.message.includes("[your key]") && !e.message.includes(KEY));
});

test("a 401 says the key was rejected", async () => {
  respond(401, { error: "bad key" });
  await assert.rejects(search("exa"), /rejected the API key/);
});

test("exactly Brave, Exa and SerpAPI are desktop-only, and nothing is left 'unknown'", () => {
  const blocked = SEARCH_PROVIDERS.filter((p) => p.browser === "cors-blocked").map((p) => p.id).sort();
  assert.deepEqual(blocked, ["brave", "exa", "serpapi"]);
  assert.ok(SEARCH_PROVIDERS.every((p) => p.browser !== "unknown"));
});

test("a link reaches the page only if it is http or https", () => {
  assert.ok(isWebUrl("https://x.test"));
  assert.ok(isWebUrl("http://x.test"));
  for (const bad of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", "   javascript:alert(1)", "data:text/html,x", "//evil.test"]) {
    assert.ok(!isWebUrl(bad), bad);
  }
});

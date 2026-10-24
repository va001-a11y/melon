/**
 * The script in client/index.html that applies the theme before the page
 * first paints (v0.6.3), so a light theme never flashes dark. It runs before
 * anything else, with nothing to catch it, so it must survive any stored
 * value. The real script is run, extracted from the shipped HTML — not a
 * copy of it that could drift.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../client/index.html", import.meta.url), "utf8").replace(/\r/g, "");
const script = html.slice(html.indexOf("<script>") + 8, html.indexOf("</script>"));

function themeFor(stored: string | null | (() => never), prefersDark: boolean): string | null {
  let applied: string | null = null;
  new Function("localStorage", "document", "window", "JSON", script)(
    { getItem: typeof stored === "function" ? stored : () => stored },
    { documentElement: { setAttribute: (_k: string, v: string) => (applied = v) } },
    { matchMedia: () => ({ matches: prefersDark }) },
    JSON
  );
  return applied;
}

test("the script is where the test expects it", () => {
  assert.ok(script.includes("data-theme"));
});

test("a saved theme is applied, whatever the device prefers", () => {
  assert.equal(themeFor('"ink"', false), "ink");
  assert.equal(themeFor('"paper"', true), "paper", "a light theme survives a dark device");
  assert.equal(themeFor('{"selection":"dusk","autoLight":"paper","autoDark":"dusk"}', false), "dusk");
});

test("the retired 'system' choice follows the device", () => {
  assert.equal(themeFor('"system"', true), "dusk");
  assert.equal(themeFor('"system"', false), "paper");
});

test("nothing stored, damaged storage, or blocked storage all fall back to Paper", () => {
  assert.equal(themeFor(null, true), "paper");
  assert.equal(themeFor("{not json", true), "paper");
  assert.equal(themeFor("{}", true), "paper");
  assert.equal(
    themeFor(() => {
      throw new Error("blocked");
    }, true),
    "paper"
  );
});

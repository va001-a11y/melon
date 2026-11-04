/**
 * Handing over the part of a page that answers the question (2026-11-04).
 * On the SCP wiki the article starts some 6,000 characters in, after the
 * site's navigation, and pages were cut to their first 3,000: agents that
 * "read" SCP-3895 were given menus and a rating widget, and guessed. The
 * page here is shaped like that one.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { excerptFor, firstProse, plainText } from "../core/src/excerpt.ts";
import { formatOpenedPages } from "../core/src/followLinks.ts";
import { formatSearchContext } from "../core/src/search.ts";

const menu = Array.from({ length: 300 }, (_, i) => `*   Menu item ${i} of the SCP wiki`).join("\n");
const banner =
  "The SCP Wiki's default theme failed to load. If you see this error and are experiencing graphical issues, " +
  "you may be able to resolve it by refreshing the page.";
const article =
  "**Item #**: SCP-3895\n**Anomaly Class**: Tiamat\n\n**Threat Level**: Black\n\n" +
  "**Description**: SCP-3895 is a Category 4 hostile hyperphysical entity attempting to assimilate all life on Earth. " +
  "x ".repeat(1500) +
  "\n\nKhonsu objects are contained by being kept in time, and the class is used across several SCP articles.";
const page = `${menu}\n\n${banner}\n\n${article}`;

test("the old cut gave the model only the menu, which is the bug", () => {
  assert.ok(page.indexOf("Anomaly Class") > 6000);
  assert.ok(!page.slice(0, 3000).includes("Anomaly Class"));
});

test("the excerpt is about the names asked for, wherever they sit in the page", () => {
  const out = excerptFor(page, ["Tiamat", "Khonsu", "SCP"], 3000);
  assert.ok(out.includes("**Anomaly Class**: Tiamat"), "the class line");
  assert.ok(out.includes("Category 4 hostile"), "and what follows it");
  assert.ok(out.includes("Khonsu objects are contained"), "every name gets a passage");
  assert.ok(!out.includes("Menu item"), "and none goes on the menu");
  assert.ok(out.length <= 3000 + 40, `kept to the room it has: ${out.length}`);
});

test("a name on nearly every line spends no room once rarer ones are found", () => {
  const out = excerptFor(page, ["Tiamat", "SCP"], 3000);
  assert.ok(!out.includes("theme failed to load"), "the banner mentions SCP, and nothing else");
});

test("a page that names nothing asked for is read from its first real paragraph, not its menu", () => {
  assert.ok(firstProse(page) > 0);
  const out = excerptFor(page, ["Zorblax"], 1000);
  assert.ok(!out.includes("Menu item"));
  assert.ok(out.startsWith("The SCP Wiki's default theme"));
});

test("a short page is handed over whole", () => {
  assert.equal(excerptFor("Short page about Tiamat.", ["Tiamat"], 3000), "Short page about Tiamat.");
});

test("both ways a page reaches a model use the excerpt: following links, and reading results in full", () => {
  const opened = formatOpenedPages([{ n: 2, page: { url: "https://w.example/scp-3895", title: "SCP-3895", text: page, links: [] } }], [
    "Tiamat",
  ]);
  assert.ok(opened.includes("**Anomaly Class**: Tiamat"));

  const read = formatSearchContext(
    "q",
    [{ url: "https://w.example/scp-3895", title: "SCP-3895", snippet: `[About](https://w.example/about)\n${page}`, fullPage: true }],
    7500,
    [],
    ["Tiamat"]
  );
  assert.ok(read.includes("**Anomaly Class**: Tiamat"));
  assert.ok(!read.includes("https://w.example/about"), "and as plain text: no addresses from inside the page");
});

test("plain text keeps a link's words and drops its address", () => {
  assert.equal(plainText("See [the class](https://w.example/tiamat) here."), "See the class here.");
});

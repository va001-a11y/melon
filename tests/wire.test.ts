/**
 * What a run request carries for each agent. "Follow links" was saved on the
 * agent and shown in its properties, but the request was built field by field
 * and never told about it, so no run followed a link, whatever the switch
 * said (2026-11-04). The tests of following links called the core directly
 * and passed throughout; only this path was broken.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { toRunAgent } from "../client/src/wire.ts";

const agent = {
  id: "a",
  name: "Qwen",
  provider: "groq",
  model: "qwen",
  apiKey: "k",
  baseUrl: "",
  role: "researcher",
  personality: "",
  active: true,
  color: "#000",
  webSearch: true,
  followLinks: true,
  team: 2,
} as any;

test("every switch on an agent reaches the run", () => {
  const spec = toRunAgent(agent, { researcher: "  careful  " });
  assert.equal(spec.followLinks, true);
  assert.equal(spec.webSearch, true);
  assert.equal(spec.team, 2);
  assert.equal(spec.groupPersonality, "careful");
});

test("switches left off arrive as off, and the page's own bookkeeping stays behind", () => {
  const spec = toRunAgent({ ...agent, followLinks: undefined, webSearch: undefined }, {}) as Record<string, unknown>;
  assert.equal(spec.followLinks, false);
  assert.equal(spec.webSearch, false);
  assert.equal("active" in spec, false);
  assert.equal("color" in spec, false);
});

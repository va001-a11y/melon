/**
 * Marketplace: curated agent bundles — ready-made teams a user can install
 * in one click. Bundles never carry API keys; the user supplies their own
 * after installing. Users can also export their own lineup as a bundle JSON
 * and import someone else's, which is how community sharing works without
 * a central service.
 */
export interface BundleAgent {
  name: string;
  provider: string;
  model: string;
  role: string;
  personality?: string;
  baseUrl?: string;
  /** Pipeline stage, 1-based. Omitted means a single-team line-up. */
  team?: number;
}

export interface Bundle {
  id: string;
  name: string;
  description: string;
  /** Who this is for, shown as a chip. */
  tag: string;
  agents: BundleAgent[];
  /**
   * A preset carries the whole workflow, not just the cast: the stage names
   * and the brief each stage works to. Without these a pipeline could not be
   * shared — the recipient would get the agents but not the arrangement.
   */
  teamNames?: Record<string, string>;
  teamBriefs?: Record<string, string>;
}

export const BUNDLES: Bundle[] = [
  {
    id: "research-desk",
    name: "Research Desk",
    description: "A researcher gathers evidence, a critic attacks it, a writer turns the result into a briefing.",
    tag: "Research",
    agents: [
      { name: "Evidence", provider: "perplexity", model: "sonar-pro", role: "researcher", team: 1 },
      { name: "Red Team", provider: "openai", model: "gpt-5", role: "critic", team: 2 },
      { name: "Briefing", provider: "anthropic", model: "claude-sonnet-5", role: "writer", team: 3 },
    ],
    teamNames: { "1": "Evidence", "2": "Challenge", "3": "Briefing" },
    teamBriefs: {
      "1": "gather the facts, sources and figures that bear on the question",
      "2": "attack the evidence above — what is weak, missing, or contested?",
      "3": "write the final briefing, taking the challenges into account",
    },
  },
  {
    id: "essay-pipeline",
    name: "Essay Pipeline",
    description:
      "Three stages: sources are gathered, a technical draft is written from them, then it is rewritten for a general reader.",
    tag: "Pipeline",
    agents: [
      { name: "Sources", provider: "perplexity", model: "sonar-pro", role: "researcher", team: 1 },
      { name: "Second Opinion", provider: "google", model: "gemini-2.5-pro", role: "researcher", team: 1 },
      { name: "Technical Draft", provider: "anthropic", model: "claude-sonnet-5", role: "writer", team: 2 },
      { name: "Plain English", provider: "openai", model: "gpt-5-mini", role: "simplifier", team: 3 },
    ],
    teamNames: { "1": "Sources", "2": "Draft", "3": "Simplify" },
    teamBriefs: {
      "1": "pull in the evidence, data and citations the essay will rest on",
      "2": "write a rigorous, well-structured essay from that material",
      "3": "rewrite the essay so a smart non-specialist can follow it, keeping every fact",
    },
  },
  {
    id: "fact-check-panel",
    name: "Fact-Check Panel",
    description: "Three independent models answer the same question so you can see where they diverge. Pair with Consensus mode.",
    tag: "Verification",
    agents: [
      { name: "Panel A", provider: "anthropic", model: "claude-sonnet-5", role: "researcher" },
      { name: "Panel B", provider: "openai", model: "gpt-5", role: "researcher" },
      { name: "Panel C", provider: "mistral", model: "mistral-large-latest", role: "researcher" },
    ],
  },
  {
    id: "explain-it",
    name: "Explain It Two Ways",
    description: "One rigorous technical answer plus one plain-English version of the same thing.",
    tag: "Learning",
    agents: [
      { name: "The Detail", provider: "anthropic", model: "claude-sonnet-5", role: "writer" },
      { name: "The Gist", provider: "anthropic", model: "claude-haiku-4-5-20251001", role: "simplifier" },
    ],
  },
  {
    id: "local-only",
    name: "Local Only",
    description: "Runs entirely on your machine through Ollama. No keys, no cloud, no cost.",
    tag: "Private",
    agents: [
      { name: "Local Writer", provider: "ollama", model: "llama3.2", role: "writer" },
      { name: "Local Critic", provider: "ollama", model: "qwen2.5", role: "critic" },
    ],
  },
  {
    id: "writers-room",
    name: "Writers' Room",
    description: "An ensemble with comic timing. Built for Sitcom and Meme modes.",
    tag: "Creative",
    agents: [
      {
        name: "The Straight One",
        provider: "anthropic",
        model: "claude-sonnet-5",
        role: "generalist",
        personality: "Deadpan. Treats absurd questions with total sincerity.",
      },
      {
        name: "The Wildcard",
        provider: "openai",
        model: "gpt-5",
        role: "generalist",
        personality: "Chaotic energy, tangents, big swings. Still lands the actual answer.",
      },
    ],
  },
  {
    id: "demo-team",
    name: "Demo Team (no keys)",
    description: "Three built-in demo models. Try the platform end to end without any API keys.",
    tag: "Try it",
    agents: [
      { name: "Demo Researcher", provider: "demo", model: "demo-research", role: "researcher" },
      { name: "Demo Writer", provider: "demo", model: "demo-writer", role: "writer" },
      { name: "Demo Simplifier", provider: "demo", model: "demo-simple", role: "simplifier" },
    ],
  },
];

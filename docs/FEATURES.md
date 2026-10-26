# Features, release by release

What each version of Melon added, changed or took away — newest first. Its
companion is [BUGS.md](BUGS.md), the record of what went wrong and what it
taught; a release that only fixed things points there rather than repeating
it here.

Each entry says what the feature is for, not only what it does, because the
reason is the part that is hard to recover later.

---

## v0.7.2 — 2026-10-26

**A tab icon.** Browsers showed their grey placeholder globe for Melon, so
it was the one tab in the bar you could not pick out. The icon is the 🍈
from the top bar, redrawn so it looks the same on every device, tilted and
shaded blue to red. Every design was judged at 16px, the size it is
actually seen at: a cantaloupe-net design that stood for models working
together was set aside because at that size it looked like the placeholder
globe itself. iPhones get their own PNG for the home screen.

**A test suite that gates every release.** `npm test` runs 69 tests, each
one a bug that shipped or nearly did. They run on every push, and the
Docker image and the hosted site publish nothing unless they pass. See the
README's Tests section.

## v0.7.1 — 2026-10-24

**Chats are stored in IndexedDB.** localStorage holds about five million
characters per site and one phone photo is most of that, so the second
photo in a chat used to fill it. IndexedDB's allowance is a share of the
disk. Existing chats move across on first start, backups keep the same file
format, and localStorage remains the fallback where IndexedDB is blocked.

**Full storage is handled rather than fatal.** Where chats still live in
localStorage and it fills, a chat is saved without its image data so every
message and reply survives, and if even that fails Melon says so and asks
before you leave the chat.

**Chat search reads only words.** It searches questions and replies, not the
stored data, where a short query matched inside any photo's encoding.

## v0.7.0 — 2026-10-24

**Five more search engines.** Serper, Linkup and Firecrawl join Tavily on
every build; Brave, Exa and SerpAPI work in the desktop app and Docker. Each
engine's availability on the hosted site was measured, not assumed — three
refuse requests from a web page, so they are shown there but disabled.

**One key per search engine.** Switching engines used to send one company's
key to another. Only the selected engine's key ever leaves the page.

**Read full pages.** An opt-in setting that has Melon read the top three
results in full through Jina Reader — free, no key — instead of relying on
one-line snippets, which is where stale figures hide.

**`scripts/probe-search.mjs`.** Checks an engine with your own key before
you rely on it, without echoing or printing the key.

**A tidier sidebar.** The ☰ button hides the sidebar on a desktop too, and
the choice is remembered. Each team folds to one line with a count of agents
switched on, and the pipeline box names the teams in order beside Merge.

**Removed: the flag button.** Its count lived only in the server's memory, so
every restart wiped it and a reload let the same reply be flagged twice. It
never added up to anything a user could act on.

## v0.6.3 — 2026-10-18

A security release; the details are in BUGS.md. What it added:

- **Request defences on the local server.** Changes need a header only
  Melon's own page sends; the server answers only when addressed as
  localhost or an IP (`MELON_ALLOWED_HOSTS` for a reverse proxy); malformed
  requests are refused instead of crashing it; cloud metadata addresses are
  refused while Ollama on a private address still works.
- **A ceiling on discussions.** "Talk until they agree" stops at 20 rounds.
- **Reply cards say what is happening** — starting, preparing, thinking or
  writing — instead of "writing…" from the moment a request leaves.
- **The theme is applied before the first paint**, so a light theme no
  longer flashes dark.
- **CI proves the defences still hold** on every push.

## v0.6.2 — 2026-10-13

**Back up just the agents, or just the chats.** A line-up travels without a
year of conversation, and a history travels without a file of API keys. A
partial restore replaces only its own half, so a chats-only file can never
delete your agents.

## v0.6.1 — 2026-10-12

**The launcher waits until Melon is ready.** It used to open the browser on
a fixed five-second timer; it now opens once both the page and the API
answer, and says which half is silent if one never does.

## v0.6.0 — 2026-10-12

**Backup and restore.** Everything Melon keeps lives in the browser, so
clearing site data destroyed it with nothing to recover from. Two exports:
without API keys (safe to keep anywhere) and with them (second confirmation,
a filename that says so, and a warning written into the file itself).

**Reasoning that arrives as text is put away.** `<think>` blocks from
DeepSeek R1, QwQ, Qwen3 and others land in the reasoning drawer, and
OpenRouter is told not to reason when you have asked for no reasoning.

## v0.5.0 — 2026-10-08

**Melon runs in Docker.** One container is the whole app:
`docker compose up -d`. It runs the server build, so local models such as
Ollama work from inside it. `MELON_BIND` chooses the listen address, the
server serves the interface itself, and CI holds a real conversation through
the container on every push.

## v0.4.1 — 2026-10-07

**A local model that is still loading says so** rather than claiming to be
writing. **Search is only spent when there is something to look up** — a
greeting no longer triggers one.

## v0.4.0 — 2026-10-06

**A first run that tells you what to do.** The first click is the keyless
demo, not the preset catalogue. **The cost estimate counts attachments**,
and attachments are capped. **The reply budget is described honestly** — it
includes reasoning. **How much of the web reaches a prompt is bounded.** The
meme tone became a creative one.

## v0.3.3 — 2026-09-27

**Web search for the whole line-up in one click**, and a pointer for
single-team users towards the team arrangement they could not see.

## v0.3.1 and v0.3.2 — 2026-09-27

Fixes only — see BUGS.md.

## v0.3.0 — 2026-09-26

**Web search for every provider, local models included.** One search per
run, shared by every agent, using the conversation's subject; citations show
as [1], and only the sources an answer used are listed.

**Reasoning models are read properly** — every reasoning block, not just the
first — and **Ollama is told its real context size**, sized to the
conversation.

**Re-ask a question.** Edit a message you sent and run it again.

**Agents treat the transcript as material, not instructions**, and a reply
with nothing to check no longer gets a "no sources" warning.

## v0.2.0 — 2026-09-01

**A web version with no install.** The same app running entirely in the
page, deployed to GitHub Pages.

**Web search with sources**, per agent, using each provider's own search.

**Conversation branching** — fork at any point into a new chat, leaving the
original untouched.

**PDFs are read in your browser**, not uploaded to be extracted. **Chat
search covers message text**, not just titles.

**Removed: "Match my system".** It disagreed with the device on Windows;
existing choices moved to the palette they were showing.

## v0.1.0 — 2026-08-25 — the starting point

The first tagged version, carrying everything built before the repository
existed:

- **Several models at once, bring your own keys** — Anthropic, OpenAI and
  any OpenAI-compatible service, Google Gemini and local Ollama, all
  streaming, with a keyless demo model.
- **Agents that collaborate** — answering in turn and reading each other,
  with roles, personalities, presets and saved selections.
- **Three ways to converse** — one reply each, talk until they agree, or
  fixed rounds.
- **Teams** — stages that run in order, each handed the previous one's work.
- **Guardrails** — token budget, token pace, context guard, preflight cost
  estimates, a dynamic agent limit and a hard cap of 100.
- **Attachments, themes, Markdown rendering, Stats**, and per-reply Copy,
  Regenerate, Continue and Retry.
- **A recovery screen** instead of a blank page when stored data is damaged.

# 🍈 Melon

Universal multi-model AI: bring your own keys, activate the models you want, and let them work through a question **together** — taking turns and building on each other, not shouting over each other. A **Stop** button next to Send kills all activity instantly.

## Run it

**Windows:** double-click **`Melon.bat`**. **macOS / Linux:** run **`./melon.command`** (on macOS, `chmod +x melon.command` once makes it double-clickable in Finder). Both are two-line wrappers around `scripts/launch.mjs`, so all three platforms share one implementation and cannot drift apart.

The launcher opens your **default browser**, whatever it is — Firefox, Vivaldi, Brave, Opera, Edge, Safari, Chrome. Melon uses only standard web APIs, so it runs in any current browser.

It checks for Node, installs dependencies on first run, reclaims any processes a previous run left behind, picks ports that are actually free on your machine, starts both servers, and opens the app. Close the window to shut it down. It works from any location — a desktop shortcut is fine.

```bash
npm install && npm run dev
```

## Features

- **Unified API layer** — adapters for Anthropic, OpenAI (and any OpenAI-compatible endpoint via custom base URL: Groq, Mistral, Together, OpenRouter, llama.cpp, ...), Google Gemini, and local Ollama. All streaming, all BYOK — keys live in your browser's localStorage and are only sent to your own local server, never stored server-side.
- **How agents converse** — tucked away in Settings, because the default should just work:
  - **One reply each** (default) — each agent answers once, then it comes back to you.
  - **Talk until they agree** — no turn limit. Agents keep discussing for as long as they need, and **end the conversation themselves** once every one of them has signalled agreement on a conclusion. Nothing is labelled or numbered, so it reads as one continuous exchange. If they never converge, the token budget, the context window, or **Stop** ends it.
  - **Fixed rounds (debate)** — a set number of passes, labelled *Round 2*, *Round 3*… since here the structure is the point.

  In the two multi-turn modes each agent is told who just spoke and asked to engage with a specific point — agree with a reason, push back, or ask a question — rather than restating itself.
- **Why is it waiting?** — Melon adds no delay of its own between turns (measured at 0 ms). A wait is always one of three things, and the card says which: the model is still writing (`writing… 4s`), an agent is queued behind another in relay mode (`waiting for Ana`), or your token pace is deliberately holding it back (`paused to slow spending`, with a banner naming the limit). Per-model time-to-first-token is in **Stats**.
- **Formatted replies** — models write Markdown by default, so Melon renders it: headings, **bold**, lists, blockquotes, code blocks, links and proper tables (which scroll rather than stretching the card). The renderer builds elements directly and never touches `innerHTML`, so model output cannot inject markup. Turn it off in Settings to see the raw source.
- **Token pace** — a slider capping output tokens per minute. It paces the stream itself, so a single agent's reply visibly slows too. Agents pause between turns to stay under it, so a long discussion stays readable and you have time to react. A live tok/min meter sits in the top bar and shows "pacing…" while it holds back.
- **Settings** (⚙) — themes, discussion length, reply length, simultaneous answering, reasoning display and token budget in one place.
- **Select theme** — six palettes (Paper, Mist, Sepia; Dusk, Ink, High contrast), applied instantly and remembered. **Match my system** is a *pairing* rather than a seventh palette: choose which light palette and which dark palette it uses, and Melon switches between them as your device does — Sepia by day and Ink by night, for instance. It says which one is in force right now, so it is never a mystery. Picking a palette directly always wins over the device.
- **Attachments** — 📎 or paste to attach **images** (PNG, JPEG, GIF, WebP), **PDFs** (text extracted server-side so any model can read them), and **text or code files** (inlined). Audio and video are refused with an explanation rather than failing silently: chat models cannot listen.
- **Context guard** — the meter shows usage against the smallest active model's window. When a chat fills it, sending is blocked with a clear message instead of the provider erroring mid-run.
- **Collaboration by default** — agents answer **one at a time in sidebar order**, each receiving the full text of every teammate who answered before it in the same round, plus an instruction to build on it, correct it, or fill gaps. Each reply shows a `↳ read …` chip naming who it could see. Reorder speakers via right-click → Move up/down. Tick **Answer simultaneously** for the all-at-once mode — faster, but agents can't see each other *within* that round (they're running at the same instant); they still see everyone's answers from **previous** rounds either way.
- **Role templates** — Researcher, Technical Writer, Simplifier, Critic, Synthesizer, Generalist keep agents from duplicating work.
- **Click-to-toggle agents** — clicking an agent turns just that one on or off and never touches the others, so any combination is a few clicks. Right-click for a context menu (edit properties, turn on/off, use only this one, move up/down, duplicate, remove). Per-role group toggles switch whole roles at once.
- **Analytics dashboard** (Phase 3) — per-model calls, success rate, input/output tokens, output share, average latency, time to first token, and a flag rate. Plus session totals: runs, agent calls, bursts, extra discussion rounds, budget aborts. The ⚑ button on any response marks it inaccurate — that is the flag signal, an explicit record of *your* judgement rather than an automatic hallucination detector.
- **Shareable pipelines** — a preset carries the whole **workflow**, not just the cast: stage names, the brief each stage works to, and which agents sit where. Installing **Essay Pipeline** rebuilds *Sources → Draft → Simplify* in one click. Exporting hands that entire arrangement to someone else as one small JSON file — a pipeline you have tuned is a thing you can give away.
- **Agent presets** — one-click install of ready-made agent sets (Research Desk, Fact-Check Panel, Explain It Two Ways, Local Only, Writers' Room, and a keyless Demo Team) with provider, model, role and personality pre-filled. Export your own agents as a shareable JSON preset or import someone else's; presets never carry API keys.
- **Teams (pipelines)** — split the line-up into stages that run in order, each handed everything the previous stages produced. Every reply is labelled with the stage that produced it (`① Sources`, `② Draft`…), and the label is stored on the reply, so reopening an old chat shows how it actually ran even if the line-up has changed since. Single-team runs show no label, since there would be nothing to distinguish. Right-click an agent → *Move to Team 2* to start one. Name each team and give it a brief, e.g. **Sources** (Perplexity, Grok — gather evidence) → **Draft** (Claude, GPT — write the technical essay) → **Simplify** (Kimi, Llama — make it readable). Within a team agents work together as usual; between teams it is always sequential. **Merge** collapses everything back to one team.
- **Saved selections** — separately, save which agents are currently on so you can restore the same line-up later.

### Preset files

Presets export as plain **`.json`** (`melon-preset-YYYY-MM-DD.json`), deliberately: anyone can open one in a text editor and see exactly what they are about to share or import. That transparency is the point — an opaque format would hide whether a secret slipped in.

**Secrets never leave the browser.** On export the API key is omitted entirely, and the base URL is stripped of query parameters and any embedded `user:pass@` credentials, because some APIs accept a key in the URL. On import Melon discards any `apiKey` it finds — a preset must never spend someone else's quota — and warns you so you can tell the sender to revoke it.
- **Support button** — an ☕ link in the top bar.
- **Chats panel** — pinned at the top of the sidebar, well separated from Agents at the bottom so a stray click can't hit the wrong one. Conversations save automatically; double-click or right-click to rename (your title is never overwritten), and opening a chat moves it to the top of the list.
- **Calm interface** — warm off-white paper with muted sage and clay accents, following your system light/dark preference. Nothing pure-white or pure-black, so long sessions stay easy on the eyes.
- **Agent editing in place** — right-click any agent → *Edit properties* opens the form pre-filled; change anything and save without deleting the agent.
- **Group presets** (Phase 2) — save the current activation state (which agents are on, which are focused) as a named preset and re-apply it in one click.
- **Personality engine** (Phase 2) — three-level inheritance composed into every system prompt: global personality (all agents) → role-group personality (✎ on the group header) → individual agent personality.
- **Burst mode** (Phase 2) — ⚡ button with an explicit consent dialog; bypasses the dynamic agent limit for the next run only, then disarms automatically. The hard cap of 100 and the token budget still apply during a burst.
- **Modes** — Professional (default), Sitcom, Meme/Creative, Research/Academic, Consensus/Fact-Check. Applied globally to every agent's system prompt.
- **Detailed CoT** — agents emit a cleaned, human-readable reasoning summary (assumptions, checks, alternatives) shown in a collapsible panel above each answer. No raw internal traces.
- **Stop** — sits next to Send, active only while agents are running. Kills every in-flight request server-side. Terminal by design: stopped replies are gone for good (no resume/pause) and you can send again immediately.
- **Context meter** — shows roughly how much of the current conversation agents must re-read each turn. **Reset** erases this chat's messages in place, keeping the chat and its name (use **+ New** to start a separate conversation).
- **Reply length** — Short / Medium / Long / Very long, capping how much each agent may write per turn. (This is the old "max tokens" control, in plain language.)
- **Per-reply actions** — every finished reply offers **Copy**, and **Regenerate** to ask that one agent again. A reply cut off by the length limit offers **Continue**, which picks up mid-sentence and appends rather than starting over. A failed one offers **Retry**. All of these re-run *only that agent*, so one bad answer never costs a whole round of everyone else's tokens.
- **Chat search** — searches titles *and* message text, so you can find a conversation by something said in it rather than only by its name. Appears once you have more than a few chats.
- **Cut-off replies explain themselves** — a reply that stops mid-sentence says why, rather than leaving you guessing: it hit the reply-length limit (with the exact number, and where to raise it), the provider's safety filter ended it, or you pressed Stop. Each provider reports this differently — `finish_reason`, `stop_reason`, `finishReason`, `done_reason` — and Melon normalises them.
- **Token guard** (Phase 2) — session-wide output token budget (settable in the top bar, 0 = unlimited). Burn is metered in real time while streams are live; the moment the budget is exhausted the whole run is aborted mid-stream. Aborted streams still count their partial burn. Budget bar + reset in the top bar.
- **Dynamic limit algorithm** (Phase 2) — the number of agents allowed to run in parallel is computed per-run from device profile (cores/memory), conversation complexity (history size), and remaining token budget, clamped to the hard cap of 100. Agents over the limit are auto-throttled (skipped, clearly labelled) and the reasons are surfaced in the UI.
- **Preflight cost estimates** (Phase 3) — a live line under the composer projects input/output tokens and USD for the next run across all active agents; runs estimated above $0.50 require explicit confirmation. Local Ollama and demo agents count as free; unpriced models are flagged rather than guessed.
- **Endpoint directory** (Phase 3) — the add-agent form ships a picker of known OpenAI-compatible providers (OpenRouter, xAI/Grok, Mistral, DeepSeek, Groq, Together, Fireworks, Perplexity, Cerebras, Moonshot…) that prefills base URL and an example model. Because `/chat/completions` is the de-facto standard, most services listed on directories like [AIxploria](https://www.aixploria.com/en/ultimate-list-ai/) plug in with just a base URL and a key — OpenRouter alone proxies 300+ models.
- **Consensus round** (Phase 3) — one click sends the panel's last answers back to every active agent to cross-check: where they agree, where they disagree and why, which claims look wrong, and a consensus verdict.
- **Guardrails** — hard cap of 100 agents enforced server-side, recommended 3–6 surfaced in the UI, token-burn warning when you exceed the recommendation, per-run max output tokens.

### Where your data lives

Chats, agents, API keys, presets, teams and settings are saved in your **browser's storage**, on your machine. They survive closing Melon, restarting the computer, and updating the app — nothing expires and there is no account.

The catch worth knowing: browser storage is tied to the exact address, **including the port**. Melon therefore remembers the port it used (in `.melon-ports.json`) and reuses it every launch, so your data is always where you left it. If something else has taken that port, Melon moves to another one, tells you clearly that this session will look empty, and explains how to get back.

Since it is browser storage, clearing your browsing data — or using a different browser — starts you fresh. Use **Presets → Export my agents** to keep a copy of a line-up you care about.

### Sending Melon to another computer

Don't copy the whole folder — run this instead:

```bash
npm run package
```

It writes **`Melon-<date>.zip`** next to the platform folder: about **110 KB**, versus 176 MB for the folder as it sits on disk. Send that one file by email, USB, or chat.

On the receiving computer:

1. Unzip it anywhere.
2. Run `Melon.bat` (Windows) or `./melon.command` (macOS/Linux).
3. The first run installs dependencies — needs internet, takes about a minute.

**Node.js must be installed there** ([nodejs.org](https://nodejs.org), LTS). Melon is a local web app and Node is the engine that runs it; if it's missing the launcher explains this and offers to open the download page.

Two reasons not to copy `node_modules` yourself:

- It is **172.9 MB of the 176.2 MB** total — over 99% of the size, and every byte of it is reconstructible.
- It contains binaries built for one operating system (`esbuild.exe`, `rollup-win32-x64-msvc.node`). Carrying those to a Mac doesn't just waste space, it breaks the install.

Your chats, agents and API keys live in the **browser**, not in these files, so they don't travel with the zip — add your keys again on the new machine.

### Publishing it on GitHub

**Push the source tree, not the zip.** A repository holding a single `.zip` is the shape malware takes; a repository holding readable TypeScript is the opposite, and readable source is the only real answer to "should I trust this?".

```bash
git init && git add . && git commit -m "Melon"
```

`.gitignore` already excludes `node_modules/`, `dist/`, `.melon-ports.json` and the `Melon-*.zip` build products, so what lands in the repo is exactly what a reader wants to see. Melon is bring-your-own-key and keeps keys in browser storage, so there is no `.env` to leak — but `.gitignore` blocks one anyway as a backstop.

The zip still has a job: attach it to a **GitHub Release**, for people who would rather download one file than use git. Repo for reading, release for running.

One thing to avoid: **don't email the zip.** Gmail blocks `.bat` attachments outright, including inside archives, and a downloaded `.bat` gets tagged by Windows so SmartScreen challenges it on first run. Send a link to the release instead — the same file, without the warnings.

## Adding models

Pick a provider from the grouped list, **type the model id exactly** as the provider writes it (lower case, dashes instead of spaces — e.g. `llama-3.3-70b-versatile`), paste your key, and press **Test connection** before saving.

The model box is deliberately never pre-filled: providers retire models on their own schedule, so a hardcoded default eventually points at something that no longer exists. Press **Fetch** and Melon asks the provider which models it serves *today*, then offers those in the dropdown.
 Melon knows each provider's endpoint, so you never type a URL unless you're using a local runtime or a custom service — and switching provider clears the previous endpoint and key, so an agent can never post to the wrong service.

Supported out of the box: **Anthropic, OpenAI, Google Gemini, xAI (Grok), Mistral, DeepSeek, Cohere, Perplexity, NVIDIA NIM (Nemotron), Moonshot (Kimi), Groq, Cerebras, Together, Fireworks, DeepInfra, OpenRouter, GitHub Models, Azure AI, Ollama, LM Studio, llama.cpp/vLLM**, plus **Custom OpenAI-compatible** for anything else — which covers most chat APIs listed on directories like [AIxploria](https://www.aixploria.com/en/ultimate-list-ai/). OpenRouter alone reaches 300+ models with one key.

> **On Copilot:** GitHub Copilot has no public chat API for third-party apps. **GitHub Models** is Microsoft's supported equivalent and is included — use a GitHub token with the `models` scope.

**No keys?** Pick the *Melon demo* provider, or install [Ollama](https://ollama.com) and run models locally for free.

### Local models (Ollama, LM Studio, llama.cpp)

Select a local provider and press **Detect local models** — Melon scans the usual ports, reports which runtimes are reachable, and fills the model list from what you actually have installed. If nothing is found it tells you what to run.

Local endpoints default to `127.0.0.1` rather than `localhost`, and Melon transparently retries the other loopback address family on failure: Node resolves `localhost` to IPv6 `::1` on some systems while Ollama binds to IPv4 only, which otherwise looks like "connection refused" even though Ollama is running.

- Client: http://127.0.0.1:5173 · Server: http://127.0.0.1:5175

Both are bound to `127.0.0.1` deliberately. On Windows `localhost` frequently resolves to IPv6 `::1` first, which breaks the client→server proxy and shows up in the app as *"Server not reachable"* even though the server is running perfectly. Using the IPv4 address on both sides removes that whole class of failure — and keeps Melon off your local network.

## Architecture

```
client (Vite/React :5173)
  └─ /api proxy ─► server (Express :5175)
        ├─ /api/registry   model capability registry (curated catalog)
        ├─ /api/run        SSE: fan out to active agents in parallel (dynamic limit applied)
        ├─ /api/stop       STOP TOKEN FLOW — terminal kill of all in-flight requests
        ├─ /api/guard      token guard state (session usage, budget)
        ├─ /api/guard/reset  reset session usage counter
        ├─ /api/analytics  per-model usage/performance (+ /reset, /flag)
        ├─ /api/extract-pdf  PDF → text so any model can read it
        ├─ /api/detect-local local runtime scan + Ollama diagnosis
        ├─ /api/marketplace  curated agent bundles
        ├─ /api/demo/v1    built-in keyless demo provider
        └─ providers/      anthropic | openai-compatible | google | ollama
```

Key server modules: `orchestrator.ts` (round loop + SSE), `catalog.ts` (providers, context windows, vision support), `stop.ts` (circuit breaker), `guard.ts` (token guard + dynamic limit), `prompts.ts` (roles, tones, personality, reasoning contract), `files.ts` (PDF extraction). Client theming lives in `client/src/themes.ts`, cost modelling in `client/src/cost.ts`.

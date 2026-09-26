# Bugs, and what they taught us

A record of every defect found in Melon and how it was fixed. It exists for
three reasons: so a fix is never quietly undone, so the same mistake is
recognised the second time, and because a project that publishes its own
failures is easier to trust than one that doesn't.

Bugs found before the repository existed are included — they were the most
instructive ones.

---

## The patterns worth knowing

Most entries below are instances of five recurring shapes. If you are changing
Melon, check these first.

### 1. Input silently doesn't arrive, so the model invents something

The most dangerous class, because the output looks *better* than an honest
failure. Four instances:

| What was lost | What the user saw |
| --- | --- |
| Web search never requested (OpenRouter) | Invented casualty figures for a real disaster, attributed to a real ministry |
| Audio refused by Melon, prompt sent anyway | Models "describing" an mp3 they never received |
| Images sent to a text-only model | Groq errored usefully; a quieter provider would have described a picture it never got |
| Claude silently strips audio | Would answer about audio it never received |

**The rule:** when input cannot reach a model, fail loudly. Never proceed with
it missing. Where the provider hides the loss — Claude strips audio rather than
refusing it — refuse before sending.

### 2. A capability is declared in the catalog and never enforced

`catalog.ts` describes what each provider can do. Three fields were correct and
consulted by nothing:

- `vision` — images were sent to every provider regardless
- `needsKey` — checked for Test connection but not for an actual run
- `contextWindow` — enforced, but with a default that wrongly blocked ten providers

**The rule:** after adding a field to `ProviderDef`, grep for a real call site.
A field nothing reads is a promise nothing keeps.

### 3. A field is added to a type but dropped in transit

Melon rebuilds objects field by field in several places, so a new field must be
added everywhere it passes through or it vanishes silently.

- `webSearch` was nearly lost in `normaliseAgent`, which reconstructs each agent on load
- `ProviderDef` was declared twice, in server and client, and had already drifted apart

**The rule:** when adding a field to `Agent`, `AgentResponse` or `ProviderDef`,
follow it through `normalise*`, `sanitizeMessages`, the run body and the adapter.

### 4. A control exists but nobody can find it

Three times a working feature was reported missing.

- Chat search, hidden until four chats and then two — reported missing twice
- Copy, which only appeared once a reply finished, so it was absent during long streams
- The scrollbar, visible but painted light on a dark theme, reading as a stray control

**The rule:** a threshold that hides a control is a decision to make it
undiscoverable. Default to showing it.

### 5. Environment assumptions that hold on exactly one machine

Windows, line endings, ports and processes produced a steady stream of these.
They are listed in full below.

---

## Before the repository (2026-08-08 to 08-24)

### Orchestration and providers

- **The pace slider did nothing.** It throttled only between turns and
  early-returned when nothing had been spent, so a single agent taking a single
  turn was a no-op. Fixed with stream-level backpressure through an awaited
  `onToken`. Verified 334 ms, then 75 s, then 150 s for the same reply.
- **Every OpenAI-compatible provider reported 0/0 tokens.** A rewrite dropped
  `stream_options: {include_usage: true}`. Restored, with a 400-retry fallback
  for providers that reject it.
- **Ollama 404 with an HTML body.** The 404 was Melon's own Express 404: a
  stale `baseUrl` survived a provider change and pointed at the wrong service.
  Changing provider now clears the URL and key, hosted providers ignore custom
  URLs, and the error says what actually happened.
- **A 7B model produced gibberish.** `allam-2-7b` made its own agent name the
  subject of the reply. The prompt now states plainly that a style governs
  *how* to write, never *what about*.
- **Changing tone mid-chat did nothing.** Earlier replies in the history keep
  conditioning style, so swapping the system prompt silently had no effect. The
  client now sends `styleChangedFrom` and the server states the change outright.
- **413 Request Entity Too Large.** Attachments were not counted in the context
  guard. They are now, the body limit rose to 40 MB, and a 413 reports the real
  size, token estimate and message count.

### Interface

- **Bold containing italics rendered as visible asterisks**, with emphasis on
  the wrong words. The inline rule forbade `*` inside a bold span. Replaced
  with a recursive, earliest-match-wins parser.
- **"Match my system" was indistinguishable from Dusk** and did not follow the
  device. Rebuilt as a pairing: choose a light palette and a dark one, and it
  alternates between them.
- **Mist and Paper hint text was unreadable** where Sepia was fine, despite an
  identical 3.54:1 contrast ratio. Measuring showed hue separation was doing
  the work, not luminance; secondary text became warm brown rather than grey.

### Windows, ports and processes

- **The batch file closed instantly with no message.** It was written with LF
  endings and `cmd.exe` requires CRLF. `.gitattributes` now pins this, so a
  fresh clone cannot regress.
- **`spawn EINVAL`.** `npm.cmd` cannot be spawned directly, and `shell: true`
  with an args array is deprecated. Fixed by going through
  `process.env.ComSpec`. The failure throws *synchronously*, so it needs
  try/catch rather than an `error` handler.
- **"Server not reachable" while the server was fine.** The Vite proxy targeted
  `localhost`, which resolved to IPv6 `::1` first. Both sides now pin
  `127.0.0.1`.
- **Zombie Node processes accumulated** — 28 were found on one occasion —
  holding ports from earlier runs. The launcher reclaims them by matching the
  command line against the platform directory, never by port, so other projects
  are untouched.
- **Dynamic ports wiped all saved data.** localStorage is scoped by origin and
  the origin includes the port, so a moving port made every chat, agent and key
  appear deleted. The launcher now remembers its port in `.melon-ports.json`
  and moves only when it is genuinely taken.
- **`explorer <url>` exits 1** and can raise a "Windows cannot find" dialog.
  Replaced with PowerShell `Start-Process`.
- **`$pid` is read-only in PowerShell**, which silently broke stale-process
  detection.

---

## In the repository (2026-08-25 to 08-29)

### The rename, and the migration it needed

`6030689` — Storage keys carried a `vedai.` prefix from the project's original
name. Renaming them without a migration would have looked exactly like data
loss: the app would read `melon.agents`, find nothing, and present an empty
install to someone whose chats and keys were still sitting there under the old
names. `migrateLegacyKeys()` runs at module load, before any state initialiser
reads storage.

**A near-miss worth recording.** A scripted find-and-replace rewrote the
migration function's *own* string literals, so it would have matched `melon.`
keys, copied them onto themselves and then deleted them — wiping every user's
data on first load. Caught by reading the file back before building.

### Crash recovery

`e55e87f` — A single malformed value in localStorage could throw during render
and leave a blank white page: no message, no reset, no hint that clearing site
data would fix it. Two layers now — normalisers shape data on the way in, and
an error boundary catches whatever escapes and offers to copy the data out or
clear only Melon's own keys.

Testing it found a second bug: `ChatView` mapped over `agentOrder` without a
guard, so a run block saved without one — by an older build, or a write cut
short — took the whole page down. It is now rebuilt from the block's own
responses rather than dropped.

### The browser build

`00cc48d` — Scoping Vite's `base` to `command === "build"` looked right and was
not: `vite preview` runs with command `"serve"`, so it served from the root
while the built HTML asked for `/melon/`. Every asset fell through to the SPA
fallback and came back as `text/html`, which a module script silently refuses
to execute. The app never mounted, with only a bare 404 in the console.

**Diagnosis that worked:** fetch each asset the HTML references and check the
**content-type**, not the status. It was a 200 that was quietly the wrong file.

### Web search

`70c826f` — **The worst bug of the project.** The line setting
`body.plugins = [{ id: "web" }]` was never in the file: a scripted edit failed
to match and was reported as done without verifying. Web search was switched on
in the UI, carried correctly through every layer, and silently dropped at the
last one. Asked what had happened in Nepal that week, the model answered from
memory and invented casualty figures, complete with fabricated attribution to
Nepal's Ministry of Home Affairs.

**How it was found:** logging both the request and the result behind the same
`if (webSearch)` guard. Five "finished" lines with zero "request" lines proved
the request-side code did not exist.

`6f7a2aa` — A reply with no sources was ambiguous: search off, or search on and
ungrounded? The ambiguity hid the dangerous case. `agent-done` now reports
whether search was *requested* separately from what came back, so the card can
warn: "Web search was on, but this model cited nothing — treat any specific
figures, dates or names as unverified." **This warning is what surfaced the
fabrication above. Do not remove it.**

`119cacd` — Citations become clickable links and are read back from
localStorage, which is hand-editable. A `javascript:` URL planted in a stored
chat rendered as a live link. Now filtered in two places: the collector when
the provider speaks, and `sanitizeMessages` on load.

### Capability enforcement

`061263b` — `supportsVision()` existed in the catalog and was **never called**.
Every adapter built image parts unconditionally, so attaching a picture to a
text-only model produced the provider's own error — Groq answers
`messages[10].content must be a string`, which tells a user nothing. The agent
now fails before the request, naming the file and the providers that could have
read it, and only that agent fails, so a mixed line-up degrades rather than
collapsing.

`c0c51f7` — Two more of the same shape:

- **`needsKey` was not enforced on the run path.** It was checked for Test
  connection and Fetch models but not for an actual run, and only two of the
  four adapters guarded for it. Melon sent unauthenticated requests and relayed
  the provider's 401 — "missing, wrong, or not authorised" — when it knew
  perfectly well which of those applied.
- **The unknown-context default was 32,000**, which wrongly blocked ten
  providers whose models handle far more. Raised to 128,000. The two failure
  directions are not symmetric: guessing low blocks a legitimate request with
  no way for the user to proceed, while guessing high lets the provider reject
  it, and that path already reports the real size and what to do about it.

`5b84720` — Models prefixed their replies with their own name:
`[Generalist (openai/gpt-4o)]: …`. The cause was Melon's own transcript
format, not the model ignoring instructions — `buildMessages` labels earlier
turns as `[Agent name]: …` so agents can tell each other apart, and models copy
that format onto their own output. The existing rule forbade making yourself
the *subject* of a reply; this was a *format* being imitated, so it did not
apply. Fixed by saying in the prompt where the labels come from, and by
stripping one anyway — in the orchestrator before the answer enters history
(otherwise the next turn re-labels it as `[Name]: [Name]: …`) and on display.

### Packaging

`npm run package` shipped a broken archive for four days. Extracting the core
into its own workspace added `core` to `package.json`, but the packager's
INCLUDE list was never updated — so every zip built afterwards declared a
workspace it did not contain, and `npm install` would fail on it. Nothing
noticed because the packager reported success either way, and the GitHub
release uses GitHub's own source archive rather than this one.

Fixed by adding `core/` (and `client/.env.web`), and by making the packager
refuse to build when `package.json` declares a workspace the list does not
cover — verified by removing the entries and watching it exit with
"Refusing to package".

### Agents impersonating each other

An agent opened its reply with **another agent's name**: `B: Adding to the
texture comparison…`, written by agent A. Agent B had errored and never ran,
so the user was reading a contribution from an agent that produced nothing.

Shown a multi-speaker transcript, a model tends to continue it — writing the
*next* speaker's turn rather than its own. The earlier speaker-label fix did
not catch this, because it only matched the bracketed `[Name]:` form Melon
itself uses, and this was a bare `B:`.

Fixed in two places. The prompt now says: write only your own turn, do not
continue the transcript, and if a teammate has not answered, say nothing on
their behalf. And `stripSpeakerLabel` takes the run's roster and strips a bare
`Name:` opener when it matches an agent actually present — checked against the
roster rather than any `Word:`, so replies beginning "Summary:" survive.

**Accepted trade-off:** an agent literally named "Note" writing "Note: …"
loses that word. Worth it against an agent publishing under a teammate's name.

### Themes

"Match my system" was removed rather than fixed again. It resolved correctly
on load — verified light gives Paper and dark gives Dusk — but users on two
separate machines reported it disagreeing with their device, and the cause is
outside Melon: Windows has two theme settings, and browsers follow "Choose
your default app mode" rather than the Windows mode most people change. A
feature that needs a paragraph of operating-system trivia to explain is worth
less than the confusion it causes. A stored "system" choice is resolved once
against the device and written back as that concrete palette, so nobody is
snapped to a default.

**Testing note:** the browser pane's `colorScheme` emulation changes the value
without dispatching a `change` event — a freshly registered listener does not
fire either — so live scheme switching cannot be tested that way.

### Discoverability

`037a38f`, `0aeb1b4` — Chat search was hidden until four chats, then until two,
and was reported missing both times, including by the person who asked for it.
It is now always visible, and its placeholder says it searches message text,
which is not otherwise guessable.

`799cc7c` — Copy appeared only in the actions row, which renders once a reply
has finished, so during a long stream there was no copy button at all. Moved to
the card header. The handler also swallowed every clipboard error silently, so
on a blocked clipboard the button did nothing and said nothing; it now falls
back to the older copy path and shows a visible failure if that fails too.

`e356e55` — Melon has six palettes and never declared `color-scheme`, so on a
dark theme the browser painted its own controls light: a white scrollbar, and
light select menus and number spinners. `prefers-color-scheme` only *reads* the
OS setting; `color-scheme` is what *declares* the page's own.

**Note:** `scrollbar-width` does not inherit. Setting it on `:root` styles the
page's own bar and leaves every inner panel with the default.

---

## After v0.2.0 (2026-09-25)

### Continue pasted two replies together without re-reading them

`2026-09-25` - Continue appends the new reply onto the cut-off one. With
Detailed CoT on, that second reply opens with its own `===REASONING===` block,
and `splitCot` read only the FIRST marker pair. Everything after it became
"the answer", markers and all - including the model's private planning for the
continuation, which the user read as content: *"The user asks to continue
exactly where the previous response stopped..."*

The display was the least of it. The merged text is what gets **saved**, so the
markers survived reload, Copy copied them, and they went back to every agent as
transcript - teaching the models that Melon's own protocol markers are ordinary
conversation text.

`splitCot` now scans the whole reply: every reasoning section joins the drawer,
every answer section joins the answer. It is the single chokepoint for display,
history, the continue seed and consensus, so one change covers all four - and
repairs chats already saved in the broken shape rather than leaving them
corrupted.

**Also fixed:** the newline after `===ANSWER===` belongs to the format, not to
the model. Left in, a continuation resuming a broken word rendered as
"high-alt ...high-altitude" - a space inside a word.

**Still divergent:** `core/src/orchestrator.ts` parses the same markers with
`.split(COT_END).pop()` - the last block, where the client now takes all of
them. It cannot cause the bug above, because the merge only happens
client-side, but it is one protocol parsed two ways in two places.

---

### A warning on every reply is a warning on none

`176b7fe` made the unverified-sources notice appear on every sourceless reply.
On *"Hello! How can I assist you today?"* it then advised treating the figures
and dates below as unverified, when the reply contained neither - two warnings
on a two-line greeting.

That is pattern 4 inverted. Not a control nobody can find, but a warning
everybody stops reading - and the reply it has to be read on looked exactly
like the ones it was crying wolf over: an invented September 2026 avalanche in
Tibet, with a death toll, a survivor count and a government response, produced
with search off.

It now shows only where there is something checkable to doubt: bare numbers,
quantities written as words, and month names. Deliberately **not** proper
nouns - "Melon", "Groq" and every model name are proper nouns, so keying on
them would fire on nearly every reply and rebuild the problem. Code blocks,
inline code, list markers, version strings, identifiers and URL paths are
excluded, so `npm ci`, `v0.2.0` and `gpt-oss-120b` do not trip it. "one" and
"two" are excluded because "one of the reasons" is prose, not a quantity.

Conservative when unsure: it returns true. A warning too many costs a glance,
one too few costs the reader's trust.

---

### Nothing said the transcript was untrusted

`2026-09-25` - not a bug that was observed, but a gap found by reading the
prompts after asking whether Melon should refuse abusive conversations. It
should not: the user is the operator, they hold the key, and a filter inside an
MIT-licensed client they compile themselves stops nobody. The provider already
enforces, and can act on a key in a way Melon cannot.

The real exposure runs the other way. Melon puts three kinds of text it did not
write in front of a model - teammates' turns, web search results, and
attachments - and a model shown a line addressed to it tends to obey. The relay
compounds it: whatever reaches one agent becomes input for the next, so one
poisoned reply travels down the line. `buildSystemPrompt` said nothing about
any of this.

It now states the trust boundary: only the user's message sets the task, and
everything else is material to weigh rather than instructions to follow, to be
reported if it tries to redirect the agent. Placed before the persona block,
which stays last by design.

A prompt instruction is guidance, not a sandbox - which is the same reason
`stripSpeakerLabel` exists alongside the prompt rule telling agents not to
write speaker labels.

---

### The fix for that truncation broke loading a 26B model

`2026-09-26` - `num_ctx: 8192` stopped the silent truncation and immediately
caused the opposite problem: gemma at 26B would no longer load at all. Ollama
allocates the whole KV cache when the model loads, so `num_ctx` is not a
limit, it is a **memory reservation made up front**. A fixed number cannot be
right for both a 7B and a 26B model on the same machine, and a setting would
only have moved the guessing onto the user.

It is now sized to the conversation being sent: estimated prompt tokens, plus
the reply budget, plus headroom, rounded up to a step. Steps rather than an
exact figure because changing `num_ctx` forces Ollama to reload the model — a
value that crept up every message would reload constantly, while crossing a
step costs one reload.

Two things keep it honest:

- **The cap is the model's own context length**, read from `/api/show` and
  cached, not guessed. The key is architecture-prefixed (`gemma3.
  context_length`, `llama.context_length`), so it is matched by suffix. The
  guard resolves the same number before it measures, so what the meter shows
  and what the model got cannot drift.
- **A conversation that genuinely does not fit fails with both numbers in the
  message**, rather than being truncated into an answer that looks whole.

If the machine still cannot find room, the adapter steps down once and
retries — the smaller window was holding the same conversation anyway, since
the step above it was headroom.

**The lesson, which is not the one from yesterday:** a constant that fixes a
correctness bug can create a resource bug. The right size was never a number
to pick; it was a number to compute.

---

### Ollama truncated silently while the guard reported headroom

`2026-09-26` - found while investigating slow local replies, which turned out
not to be a bug at all. The Ollama entry declared no `contextWindow`, so it
fell back to the 128,000 default, and the adapter never sent `num_ctx`. Ollama
defaults to 4096 and does not reject an oversized prompt - it truncates and
says nothing. A long local chat therefore lost the start of the conversation,
system prompt included, while Melon's guard showed plenty of room.

The default errs high on purpose, and the reasoning is sound: a hosted
provider rejects an oversized request and reports the real limit, so guessing
high is recoverable while guessing low blocks legitimate work. That argument
depends on the provider *complaining*. Ollama does not, which is what made it
the exception.

Both sides now come from one exported constant, `OLLAMA_NUM_CTX`, sent with
every request and declared in the catalog, so the guard cannot drift from the
window the model was actually given. `keep_alive: "30m"` went in alongside it,
which only helps a model that has gone idle.

**Pattern 1 and pattern 2 at once:** input silently not arriving, because a
catalog field was declared and never sent.

### Not a bug: local replies are slow because CoT doubles them

Measured on the same machine: bare `ollama run` 9.9s, Melon with Detailed CoT
off 8s, Melon with it on 14s. Melon is not slower than the CLI - it was faster,
the model already being resident. Detailed CoT makes the model write a
reasoning summary *and* an answer, so it generates roughly twice the tokens,
and locally every token is wall-clock time.

Recorded because the first diagnosis was wrong. `keep_alive` was ranked the
prime suspect on reasoning, and a stopwatch outranked the reasoning.

---

### The sources list claimed more checking than happened

`2026-09-26` - the same screenshot as the entry below, but a different fault,
and this one was mine rather than the model's.

The reply cited three of the five results. The card said **5 sources**, and
listed the two about a building collapse in Manhattan. Melon attached every
hit the search returned, whether or not the answer rested on any of it.

The model had done the right thing. The search block already tells it to use
the results "where they are relevant" and to say plainly when they do not
answer the question, and it obeyed: sources 3 and 4 appear nowhere in the
prose. Strengthening that instruction would have changed nothing.

Only the sources actually cited are listed now, renumbered so a `[3]` in the
prose still points at the third entry on screen. Everything is kept when the
answer cites nothing, since many models never write a marker and showing no
sources would be worse than showing too many. Provider-native citations are
never pruned: those are the provider's own account of what it read, and
pruning them against markers the model never wrote would delete all of them.

**The general point:** citations exist to show what an answer rests on. An
unread page is not a source, and listing it implies a breadth of checking
that did not happen.

---

### A follow-up question searched for the wrong continent

`2026-09-26` - found on the first live test of web search, with a real key.

"What tragedy happened recently in Nepal?" returned AP, BBC and NBC. The
follow-up, "Did the immigration building collapse?", was sent to the search
API exactly as typed - no Nepal, no flood - and came back with *New York
Building Collapse Scare* and *Midtown Manhattan buildings evacuated*,
alongside Facebook and Instagram clips. The model then wrote confident,
specific detail on top of that mixture, and gave 1,200 deaths where its own
previous answer had said 1,300.

The conversation knew the subject. The search did not. Melon now appends the
previous question as context, current message first so that trimming drops
the older context rather than what was just asked.

**The limit, stated:** this helps a follow-up on the same subject and does
nothing for one that changes subject mid-conversation. Having a model write
the query would handle that, at the cost of an extra call before every
search.

**Worth sitting with:** this is the Nepal fabrication again, arriving through
the feature built to prevent it. Sources make an answer *checkable*, not
*correct*, and a plausible answer built on the wrong sources is harder to
catch than one built on none - the citations make it look verified.

### Models wrote their own citation markers into the prose

`2026-09-26` - `gpt-oss-120b` cited its sources as `【1†L1-L4】`, mid-sentence,
in finished text. It is the marker format OpenAI models are trained to emit
for tool results; it was never meant to be displayed.

Rewritten to `[1]` rather than removed, because the number identifies which
of the listed sources the sentence came from - deleting it would throw away
the citation while leaving the claim. Markers that parse to no number are
dropped, and the space left before a full stop is closed up.

Applied in the core, so saved history is clean, and again on the client's
display path, so chats saved before the fix read correctly when reopened.

---

### Every agent ran its own copy of the same search

`2026-09-26` - introduced and fixed the same day, found by re-reading the
code rather than by anyone hitting it.

The Melon-side search sat inside the per-agent run, and the query is the
user's message, so a four-agent panel made four identical requests. Measured
before the fix: three agents, three calls.

The quota cost is the obvious half - a free tier of 1,000 searches becomes
250 questions. The real problem is the other half: search APIs do not return
the same pages twice running, so the agents could be handed **different
evidence for the same question**. A panel arguing from different sources
reads as models disagreeing on facts, when they were simply shown different
pages. For a relay whose whole point is agents building on each other, that
is the worst possible way to fail.

One search per run now, memoised as the promise rather than the result so
that agents answering simultaneously share a single in-flight request instead
of racing. A failure is shared too: if the search API is down or out of
quota, retrying per agent would spend more quota to fail the same way.

**Worth noting for next time:** the per-agent placement was natural, because
that is where the agent's own capability is known. Anything derived only from
the user's message belongs above the loop.

---

### Search existed for five providers and nowhere else

`2026-09-26` - a gap rather than a defect, but the same shape as the ones
above. Web search was provider-native only, so on Groq, Mistral, DeepSeek or
any local model the toggle was simply disabled. That is honest, but it left
the majority of the catalog answering from training data with no way to check
anything - and the Nepal fabrication is what that looks like when it goes
wrong.

Melon now runs the search itself when the provider cannot: Tavily or Brave,
the user's own key, results handed to the model as numbered material and
attached to the reply as citations. Local models included, which no
provider-native search could ever reach.

Three decisions worth recording:

- **It fails loudly.** Search on, no way to run it, and the agent errors
  instead of answering. Silence here is exactly pattern 1.
- **Round 0 only.** Later rounds are agents discussing what was already
  found; re-searching each round would spend the user's quota re-fetching the
  same pages.
- **The results are prepended to the user's message, not sent as their own
  turn.** Most APIs reject two user messages in a row, and the question
  should still be the last thing the model reads.

The search block is labelled as material rather than instructions, which is
the TRUST clause added the day before doing the job it was written for: this
feature is what puts open-web text into the prompt.

---

### The context menu was sliced off mid-word on narrow screens

`2026-09-26` - right-clicking an agent on a phone-width layout produced a menu
pushed off to the right with every label cut off: "Turn", "Mov", "Dupl",
"Rem".

`.context-menu` is `position: fixed`, and its coordinates are calculated
against `window.innerWidth`. That is correct everywhere except inside the
narrow-layout sidebar, which is a drawer: `transform: translateX(...)` to
slide in, `overflow-y: auto` to scroll. **A transformed ancestor becomes the
containing block for `position: fixed` descendants**, so the menu was placed
relative to the drawer while being measured against the viewport - and then
clipped at the drawer's 320px edge, because `overflow-y: auto` clips the other
axis too.

Rendered into `document.body` through a portal, which escapes both the
transform and the clip, and changes nothing on desktop where the sidebar has
neither.

**Worth remembering:** `position: fixed` is only viewport-relative until some
ancestor has `transform`, `filter`, `backdrop-filter`, `will-change` or
`contain`. Any of those silently redefines it, and a responsive drawer is
exactly where one appears.

---

### A reasoning model's whole reply went in the bin

`2026-09-26` - reported as "Ollama ignores presets and Modes". It was not
ignoring them.

Reasoning models on Ollama answer in two channels: `message.thinking` and
`message.content`. The adapter read only `content`. So the reasoning was
discarded, and when the reply-length budget was spent thinking, `content`
arrived empty and Melon rendered a **blank card** for a model that had worked
correctly. Measured on gemma4:26b: thirty tokens generated, nothing shown.

From the outside that is indistinguishable from a model ignoring its
instructions, which is exactly how it was reported.

**The first diagnosis was wrong and is worth recording.** `ollama show` gives
gemma4 the template `{{ .Prompt }}` — no `.System` anywhere — so the obvious
conclusion was that Ollama never passes the system prompt on. It does; it
handles the system role itself regardless of the template. The experiment that
settled it took one request: with `think: false` the same model answered
`BANANA` to "What is 2+2?", having been told to. The instructions were always
arriving and always being obeyed.

Thinking is now wrapped in Melon's own `===REASONING===` markers as it
streams, so it lands in the same drawer every other provider's reasoning uses,
and a reply can no longer be empty when the model produced output. Wrapped
even when Detailed CoT is off: the drawer is collapsed anyway, and throwing
away what the model wrote is the defect — showing it is not.

**The same fault was in the OpenAI adapter**, found by grepping for other
instances rather than waiting for a second report. Reasoning models over that
wire use a field beside the answer, and it is not standardised — DeepSeek
sends `reasoning_content`, OpenRouter sends `reasoning` — and only `content`
was read. That adapter speaks for a dozen services, so DeepSeek-R1 and QwQ
anywhere would have lost their reasoning the same way. Both now read it.

**The pattern, again:** output silently not arriving is as dangerous as input
silently not arriving. Pattern 1 has a mirror image.

---

## Testing notes that cost time to learn

- **A `window.fetch` recorder does not see** dynamic `import()` or Worker
  loads, so a "zero network calls" result needs reading carefully.
- **Background tabs throttle timers** to roughly one per second, so anything
  built on `setTimeout` — the token pace limiter, the demo adapter's pacing —
  crawls when the tab is hidden. `MutationObserver` is not throttled and is the
  reliable way to catch a short-lived UI state.
- **HMR preserves stale inline styles.** Hard-reload before trusting any
  measurement of something the code sets through `element.style`.
- **A programmatic `.click()` is not a user gesture**, so `clipboard.writeText`
  rejects. Clipboard behaviour has to be tested with a real click.
- **Browsers cache negative responses.** A 404 served during a broken moment
  persists after the fix; test on a fresh port or bypass the cache.
- **Verify scripted edits by grepping for the inserted text.** The single most
  expensive bug in this project came from trusting a script that reported
  success without having matched anything.

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

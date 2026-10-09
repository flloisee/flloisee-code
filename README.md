# flloisee-code

A chat application that talks to whichever AI backend you point it at — a model running
on your own machine, or a hosted service — without the app caring which.

Pick an **Endpoint**, pick a **Model**, and talk to it. Switch either one mid-conversation
without losing what you have said so far.

**Status: v1.** All nine tracked tickets are resolved. The spec lives at
`.scratch/multi-endpoint-chatbot/spec.md`. The domain vocabulary used below is defined in
[`GLOSSARY.md`](./GLOSSARY.md), which names this feature **Multi-Endpoint Chat** — the name
used throughout the codebase.

## Endpoints

An **Endpoint** is a configured address for an AI backend: a base URL, an optional
**Credential**, and one or more **Models**. The app holds a single list of them — 189 in
total — and never asks where it should connect.

### Local Endpoints

Served from the machine running the app. **No Credential, no account, no signup** — usable
the moment the server is up.

| Endpoint | Address | Starting Model |
| --- | --- | --- |
| Ollama | `http://localhost:11434/v1` | `llama3.2` |
| LM Studio | `http://127.0.0.1:1234/v1` | `qwen/qwen3-coder-30b` |

These are declared by hand in `lib/endpoints/registry.ts`, not drawn from the Catalog. Start
Ollama and you can chat; it is the fastest path to a working Conversation.

### Cloud Endpoints

**187 catalogued services**, snapshotted from the community-maintained
[models.dev](https://models.dev) database on 2026-10-09 — including OpenAI, Google Gemini,
DeepSeek, Groq, Mistral, OpenRouter, GitHub Copilot, Hugging Face, NVIDIA, Alibaba, Moonshot,
Fireworks AI, Baseten, Nebius, and many more — the full list is the Catalog itself.

Each entry carries a name, a base URL, a documentation link, its Credential's variable
name, and its newest Models. Five are offered up front in a **Recommended** group —
OpenAI, Google, OpenRouter, DeepSeek, Groq — and the rest sit under **Cloud (Others)**.

The Catalog is committed to source control and reviewed as code. That is deliberate: it
decides *where your Credential is sent*, so a changed base URL has to arrive as a
reviewable diff rather than silently over the network. Regenerate with:

```bash
node scripts/refresh-catalog.mjs <models.dev-api.json>
```

`validateCatalog()` runs before anything is allowed to send a Credential anywhere.

### One integration covers nearly all of them

Every Endpoint here speaks the OpenAI chat format, so a single code path drives all 189 —
no per-provider adapter. Endpoints with a proprietary format are out of scope; Anthropic's
native message format is the notable absence, though Claude is reachable through OpenRouter,
which is catalogued.

## Model Discovery

Rather than making you remember model identifiers, the app asks an Endpoint which Models it
currently offers and presents them as a list you pick from.

Discovery runs on demand and can be re-run to pick up a model you just loaded. Endpoints
that don't support it — or return nothing — fall back to a free-text field, so you can type
an identifier when you know it. Each Endpoint remembers its own selected Model, so
switching back and forth doesn't reset your choice.

## Key Entry

A Cloud Endpoint's Credential is typed into the interface rather than hand-edited into a
file. Key Entry writes it to `.env.local` and applies it **immediately** — the environment
is reloaded in place, so there is no restart to wait for.

The interface never displays a stored value back to you. It reports which variable names are
present and what is actually live, so you can confirm setup without exposing anything.

Two routes write files, and they are bounded differently — because what they write is
different. Key Entry writes a Credential, and it is bounded accordingly:

- **Development only.** It refuses to run outside development, so a deployed build has no
  capability to write secrets at all.
- **Declared names only.** Only variable names the Catalog already declares may be written.
  A caller-supplied base URL is rejected outright, so reaching this route cannot redirect
  where a Credential goes.
- **Atomic.** Written to a temporary file and renamed, so an interrupted write cannot corrupt
  the keys you already have.
- **Non-destructive.** Comments, ordering, and unrelated variables survive untouched.
- **Write-only.** Stored values are never returned.

The Reading Root route writes which folder the Model may read into `.reading-root.json`, and
is bounded by containment rather than by refusing to run. Like the one above it is development
only, and it writes atomically to a gitignored file. It holds a **Root** and the **Grants**
given beyond it; a Grant is an addition to that boundary and never a substitute for it, and the
server resolves and checks every path it is given rather than trusting a caller's word for it.

What that route can be reached to do is worth stating exactly, because it is narrower than it
may sound and wider than "it only lists folders". In development, a caller can name **the
reader's own home directory or any path under it** — that is the walk's edge, and every path
it is given, the way back up included, is put through it before the disk is touched — and be
handed back the names, the kinds and the real paths of what is in the folder it named. It can
also be given **a name rather than a path**, and answer with the folders inside the home
folder carrying it, in full and without choosing between them. That last one is how you pick
a Root at all: no browser folder dialog can return a path, since Chrome removed `File.path`
in v61 and nothing has replaced it, so your own machine's dialog hands the app the folder's
**name** and this route is what works out where that name really is. The alternative — opaque
handles for entries the server itself offered, so a caller can only ever walk where it has
already been — was considered and rejected as a second source of truth with a lifetime to
invalidate across a dev-server reload, for a route that is development-only and can write
nothing but a Root. What it cannot do is read a file's contents, write anywhere but the one
Root file, or do either outside development.

Both write atomically and both are gitignored.

An **unconfigured** Endpoint stays visible in the picker, marked, so its absence is
diagnosable rather than a failed request discovered later.

## Proxying

Every request goes from your browser to this app's server and out to the Endpoint. No
request ever travels browser-to-Endpoint directly, so no Credential is ever inlined into a
request the browser builds or into the client bundle.

**A Turn's contents are whatever the reader attached and whatever the Model read, sent to
whichever Endpoint was selected.** Both halves land in the same Conversation and in the same
Saved Conversation, and either may be a file off this machine. The Endpoint and Model in use
are named above the composer rather than only in the transcript, so the destination is read at
the moment a file is named — and a file is named as text inside the message, never as a file
part, because most of the Endpoints in the Catalog would not take one.

One consequence is worth stating plainly: **the security posture here depends on the app
staying local and single-user.** Proxying means the server holds every user's Credential —
fine for one person on their own machine, not for many. Reading files makes the same
assumption load-bearing a second time, and for a different reason: the server now reaches
off its own directory, so anything that can reach it can ask this machine for file contents.
The walk is held to your home folder, every path is resolved through its links and checked
rather than taken on a caller's word, and the route that names a Root refuses to run outside
development — but those are checks on an unauthenticated route, not a boundary. They hold
because there is one reader and the reader is the person running the server. Hosting it would
need both an authentication story and a replacement for the key-entry route. If multi-user
hosting ever becomes the goal, that decision should be reopened rather than patched.

## API

Seven Route Handlers, **all `POST` by design**. With Cache Components enabled, a `GET` handler
follows the prerender model of a page — so a response varying by Endpoint would be frozen at
build time and every Endpoint would report the same answer. A silent wrong result rather
than a visible failure.

| Route | Purpose |
| --- | --- |
| `POST /api/chat` | Hold a Conversation. Streams a Response back progressively. |
| `POST /api/endpoints` | The Registry, with each Endpoint's configured state. |
| `POST /api/models` | Model Discovery against one Endpoint. |
| `POST /api/hardware` | What machine this app is running on. Takes nothing. |
| `POST /api/recommendations` | Which Models would run at a given speed on that machine, and in which order to show them. |
| `POST /api/keys` | Key Entry. Development only. |
| `POST /api/roots` | Naming a **Root**, the **Grants** beyond it, the reader's own answers, and where a folder of a given name really is. Development only. |
| `POST /api/files` | Naming a file from the Root: the `@` menu, and a verdict on a path the reader wrote. |

Chat and discovery are deliberately separate seams: discovery fails with a bad address or a
missing Credential, generation fails for entirely different reasons, and collapsing them
would make every failure look like a chat failure. The same reasoning splits Root from
files: choosing a folder is a write to this machine and refuses to run outside development,
while asking what is in one writes nothing and therefore works in any build.

`/api/hardware` and `/api/recommendations` take a deliberately narrow view of what a caller
may say. The first takes **nothing** — `.strict()` on an empty object — because it shells out
to fixed tools with a fixed argument vector, and the rule that no caller can influence which
is the whole point of it. The second takes a bounded number and a choice from a closed list of
two fits. Neither can name a repository, a search term or an address, so neither can be turned
into a proxy for fetching something of a caller's choosing.

## What would run on this machine

Settings carries a **Hardware** section that answers a question the app otherwise
cannot: not which Model is loaded, but **which Models from Hugging Face would run
well on this machine**, so you can go and get one and use it offline.

It reads the machine's own chip, memory and memory bandwidth, browses Hugging
Face's quantised text-generation Models, measures the real size of each, and
offers the ones that fit — each linking to its repository page so you can
download it yourself. The app downloads nothing; it is advice, not an installer.

A **slider** sets how many tokens a second is worth having, because the right
answer depends on the machine and a fixed threshold picks one for you. On a 16 GB
M4, 50 tokens a second permits only sub-2B Models; at 20, `Qwen3-8B` appears at
roughly 21 tokens a second. That trade-off is the feature.

### Two fits, one budget

Below the hardware row, the section answers that question two ways, and the tabs
pick between them. **Speed fit** leads with pace and is ordered by downloads.
**Intelligence fit** leads with how much Model is in the file and is ordered by
parameter count, downloads breaking a tie.

They are not one list in two orders, and the difference is worth stating plainly:
the twenty most-downloaded quantised text-generation Models on the Hub are small
ones, so re-ordering *those* by size would still be a list of small Models. The
Intelligence fit spends its twenty measurements on the largest candidates instead.
Same twenty requests, and the only way the second tab can be anything other than a
reshuffle.

The slider serves both. Dragged to its floor the speed stops being the binding
constraint, memory takes over, and "intelligence over speed" becomes simply the
largest Model this machine can hold — at whatever pace that turns out to be. The
pace is still shown on that tab, because the most capable Model a machine can hold
may be far too slow to use, and hiding the number to make the tab look better
would be the one thing this section must not do.

Parameter count is a proxy for capability and the interface says so where the
list is drawn, in the same way the speed fit admits that downloads are popularity
rather than quality. Neither ordering is a measurement of merit.

Three things it will not do, each because the alternative is a confident wrong
answer:

- **No speed figure for an unknown chip.** The bandwidth table is hand-written;
  a chip with no row gets no estimate rather than a guessed one.
- **No quantisation below four bits.** A 2-bit or 3-bit Model decodes quickly
  *because* it carries almost none of the Model, so ranking on speed alone is
  ranking on how badly it survives. Where a Model is offered, it is the smallest
  quantisation at or above `Q4_K_M` — the community default — because the bigger
  ones are a far larger download for a difference nobody would notice.
- **No fits at all when your Models run on another machine.** Everything shown is
  computed from the chips of whatever machine serves the app. If your Model
  server is on a NAS across the hall, those are the wrong chips, so the section
  says so and offers nothing. The specs it did read are still accurate and still
  shown.

A fourth refusal belongs to the Intelligence fit specifically, and it is the one
that would otherwise make a large machine look broken. Its prefilter asks whether
a Model could be *recommended*, not whether it could run, by testing the
parameter count at `Q4_K_M`'s 4.85 bits rather than at the 4-bit floor. On a
192 GB machine that gap is the difference between a 235B Model looking like 117 GB
and looking like 142 GB — and the very large Models that exist *only* as 2-bit
files sit exactly in it. Left in, twenty measurements go to repositories that all
fail the quality floor and the tab returns nothing at all on precisely the hardware
that could have had a good answer.

### Platform coverage

Speeds and sizes are only offered where the chip could actually be identified. The
table is the honest state of it:

| Platform | GPU detected | How, and how well tested |
| --- | --- | --- |
| macOS | Yes | `system_profiler SPDisplaysDataType`. Verified against a live Apple Silicon Mac |
| Linux + NVIDIA | Yes | `nvidia-smi --query-gpu`. Written from its documented output; **not run against real hardware** |
| Linux + AMD | Yes | `rocm-smi`. Written from its documented output; **not run against real hardware**, and lenient because its output shape varies by ROCm version |
| Windows + any GPU | No | Deliberate. `wmic` reports `AdapterRAM` as a 32-bit integer, truncating at 4 GB, so a 24 GB card reads as 4 and every Model would be marked too large. CPU and RAM are still reported; no fits are offered |
| Any, CPU only | No | RAM is reported. No fits, because there is no bandwidth figure to estimate from |

Where a row says "not run against real hardware", the parser is written against
that tool's documentation and is defensive — it returns nothing rather than half
reading — but it has not met a card. A machine in that category is treated as one
with no GPU until it proves otherwise, which is the safe direction: a reader with
a working NVIDIA card is told nothing rather than told something wrong.

### What it asks of Hugging Face, and what it never sends

This is the app's first outbound request to a third party that a reader did not
name. It is anonymous, carries no Credential, and is made only when the slider is
moved — never on page load, so a reader who opened Settings to change the Theme
has not caused a call. The request carries nothing from the reader's
environment, and there is a test that fails if an `Authorization` header ever
appears in one.

Models are browsed rather than searched, because a reader asking what they could
run is not yet able to say what they want. The listing is filtered to quantised
text-generation Models and ordered by downloads, which is the only quality signal
available that is somebody else's judgement rather than this app's. It is
popularity, not merit, and the section says so where the list is shown.

## Reading files

Give the Model a **Root** — one folder on your machine — and it can list it, read from it,
and search it, using three **Tool**s. Anything outside that folder it does not get: it stops
and puts an **Approval Request** to you, and you answer for that one read or for good. A
**Grant** is the answer for good — remembered between visits, and listed in Settings with a
button to stop allowing it. A path is taken as relative to the Root unless you write it out
in full. Searching is a walk, and the walk skips `.env*`, `.git` and `node_modules` and
honours your `.gitignore`; listing one folder shows you everything in it, which is how you
find the folder worth searching.

You choose the Root in Settings, from your own computer's folder dialog — the native one where
the browser has it, a folder input where it does not — and what that dialog gives the app is
the folder's **name**, never a path. The app then looks for folders with that name inside your
home folder and shows you each one's full path before anything is recorded, because two folders
on one machine can easily share a name and a `Projects` on a disk it cannot reach would
otherwise be answered with the `Projects` in your home folder, silently. You can walk to a
folder instead, from your home folder down, if a name is not enough.

You can also name a file yourself. Typing `@` in the composer offers what is in the Root,
matched against the path as well as the name, and pasting a path into a message asks about it
**before** the message can be sent — you named it, the Model did not, and an approval
appearing mid-Response would claim an agency that is not there. Either way the contents go
into your message as a block of text naming the file, never as a file part, which is dull
and works against every Endpoint here where a file part would not.

The transcript shows every read — which Tool was called, the path it was given, and what came
back — so a claim the answer makes about your files can be checked against them. Earlier
Turns are left as they were; only the message you just sent gains the blocks.

## Interface

- Responses stream progressively, and a Stop control abandons one mid-flight — the server
  stops generating too, rather than burning tokens on an answer nobody will read.
- Regenerate retries the last Response without retyping, which also makes a transient
  failure cheap to recover from.
- Answers render as formatted Markdown (GitHub-flavoured), with a copy button on every code
  block.
- The Endpoint and Model you chose are remembered between visits, so a Credential-requiring
  Cloud Endpoint does not have to be set up again every time you open the app. Choices are
  kept per Endpoint, so switching back brings the Model you chose there with it.
- Conversations are saved to the browser's own storage and reopen after a reload, listed newest
  first in a sidebar. Each is named from the message that opened it — cut to something
  scannable — and can be renamed or deleted.
- "New" starts a fresh Conversation. An empty one is not saved, so the list holds no blank rows.
- Where storage will not open, the interface says so and carries on without saving. Losing a
  save never costs you the Turns already on screen.
- Failures name the cause — start Ollama, re-enter a Credential, or pick a different Model —
  and never expose a Credential, so an error can be screenshotted safely. A failed request
  leaves the Conversation intact.

## Getting started

Requires Node 20.9+ (Next's engine requirement) and [pnpm](https://pnpm.io) (pinned to 12.3.4
via `packageManager`).

```bash
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) and you land straight in the
Conversation.

**Build against a Local Endpoint first.** Start Ollama or LM Studio, and you can chat with no
setup whatsoever. Cloud Endpoints can be verified afterwards — enter their Credentials
through the interface when you want them.

### Scripts

| Command | What it does |
| --- | --- |
| `pnpm dev` | Development server. |
| `pnpm build` | Production build. |
| `pnpm start` | Serve the production build. |
| `pnpm test` | Vitest suite — 1155 tests across 82 files. |
| `pnpm typecheck` | `tsc --noEmit`. Needs Next's generated route types, so run `pnpm dev` or `pnpm build` first in a fresh checkout. |
| `pnpm lint` | ESLint. |
| `pnpm test:mutation` | Mutation check on the security-critical paths. |

`.env.local` is gitignored. Credentials entered through the interface are written there and
are never committed. So is `.reading-root.json`, which records the folder the Model may read:
it holds this machine's own directory layout, which is nothing to do with the app.

## Stack

Next.js 16.4 (App Router, Cache Components, Turbopack) · React 19.3 · TypeScript · Tailwind
CSS v4 · Vercel AI SDK v7 (`@ai-sdk/openai-compatible`) · Zod v4 · Vitest 5 · pnpm 12.3.4.

## Out of scope for v1

Named here so their absence reads as a decision rather than a gap:

- Anthropic and any Endpoint not speaking the OpenAI-compatible format
- Sharing Saved Conversations between machines or people — they live in the
  reader's own browser, with no account and no copy anywhere else
- Searching or filtering Saved Conversations; the list is ordered by recency and
  nothing else
- Image attachment; a genuine image needs a Model that accepts one, and the same Turn has to
  work against every Endpoint in the Catalog
- Writing, moving or deleting a file — the Tools only read
- Reasoning-token display and source citations
- Authentication and multi-user support
- Deployment to hosted infrastructure, which would put Local Endpoints out of reach

## Endpoints of your own

Beyond the Catalog, the reader can declare an Endpoint the app has no entry for — a
vLLM box, a llama.cpp server, anything speaking the OpenAI-compatible format on
their own network. Settings carries the button; the Endpoint is written to
`.endpoints.json` beside `.env.local` and appears under **Added by you**.

A Credential is optional, because a server on your own machine usually needs
none, and several may be listed — the first is the starting Model until you pick
another, and Model Discovery replaces that list as soon as the Endpoint answers.

**No Credential goes in `.endpoints.json`.** It is written to `.env.local` under
`CUSTOM_<ID>_API_KEY` by the same writer that handles every other key in this
app, so the file holds an address and a name and nothing that authenticates.
Both files are gitignored.

### What this gives up, stated plainly

Until now every base URL was fixed in source, which is what let `POST /api/keys`
refuse any body carrying an address — a caller naming its own destination beside
a known provider's Credential is a way to collect that key elsewhere. That
refusal is unchanged and the Catalog's addresses are still in source, so a
Catalog Credential still cannot be redirected.

What is new is that a caller who can reach `POST /api/endpoints/declared` can
make the server issue an outbound HTTP request to any address they name. That is
a weaker primitive than the one above and it is not nothing: the Credential
travelling with it is one the caller just typed, so there is no existing secret
to steal. The route answers 404 outside development, as `/api/keys` and
`/api/roots` do, and the address is checked on the way in — http or https only,
no embedded credentials, no empty host. The reasoning is written out in full in
`lib/endpoints/custom.ts`.

## Layout

```
app/
  api/{chat,endpoints,files,keys,models,roots}/   Route Handlers, with tests alongside
    endpoints/declared/                 Declaring an Endpoint of your own, and forgetting it
  page.tsx                            The Conversation, at the root
components/
  workspace.tsx                       Saved Conversations beside the chat
  conversation-list.tsx               The list of Saved Conversations
  settings.tsx                        Settings, as a dialog over the list
  modal.tsx                           The shell both dialogs sit in
  endpoint-picker, model-picker, key-entry, chat surface, markdown, theme-toggle
  declare-endpoint                    Adding an Endpoint the app has no entry for
  root-picker, file-menu, named-files, tool-call, approval-answer
lib/
  conversations/                      Store, naming, the hook over both
  endpoints/                          Catalog, Registry, grouping, resolution, validation
    custom.ts                         Endpoints the reader declares, and `.endpoints.json`
    use-registry.ts                   The one live answer about the Registry, shared
  models/                             Discovery, parsing, selection
  selection/                          The Endpoint and Model kept between visits
  hardware/                           Probing this machine, and what would run on it
    probe.ts                          CPU, memory and accelerator, via the platform's own tools
    bandwidth.ts                      Per-chip memory bandwidth — the estimate's weak joint
    speed.ts                          Bandwidth ÷ size, and the cliff where a Model spills to disk
    where.ts                          Whether the Models run on this machine at all
  huggingface/
    catalogue.ts                      Browsing what would fit, and measuring what survives
    quant.ts                          Quantised weights: aux files, shards, and the quality floor
  theme.ts                            The Theme, and the Preference Store
  env.ts                              The only place a Credential is written
  roots/                              The Root and its Grants, containment, the two walks and the name search
  tools/                              The three Tools, the approval policy, what they refuse
  chat/                               Failures as readable text; the files a Turn names
scripts/                              Catalog refresh, mutation check
```

The code for reading landed in `lib/roots/`, `lib/tools/` and `lib/chat/` rather than in one
`lib/reading/`, which the spec guessed at: the boundary, the Tools over it and the place a
Turn meets it are three different concerns with three different sets of tests.

`lib/roots/readable.ts` holds `mayRead`, the one answer to "may the Model read this" that
everything asks — the three Tools, the `@` menu, the pasted-path check and the recheck at
send — so there is one set of answers rather than several to keep in step.
`lib/endpoints/catalog.ts` is the highest-leverage file in the repo: it decides where
Credentials are sent and is the most likely to need maintenance as model identifiers shift.
Treat changes to either with the care of a dependency bump, not a copy edit.

## Further reading

- [`GLOSSARY.md`](./GLOSSARY.md) — the domain vocabulary, including which words to avoid
- [`.scratch/multi-endpoint-chatbot/spec.md`](./.scratch/multi-endpoint-chatbot/spec.md) — the
  spec, its decisions and rationale, and what was deliberately left out
- [`AGENTS.md`](./AGENTS.md) and [`docs/agents/`](./docs/agents/) — conventions for working
  in this repo

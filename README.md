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
may sound and wider than "it only lists folders". In development, a caller can name **any path
under the reader's own home directory** and have it checked against home. It cannot read that
file's contents, cannot write anywhere but the one Root file, and cannot do either outside
development. The alternative — opaque handles for entries the server offered, so a caller can
only ever walk where it has already been — was considered and rejected as a second source of
truth with a lifetime to invalidate across a dev-server reload, for a route that is
development-only and can write nothing but a Root.

Both write atomically and both are gitignored.

An **unconfigured** Endpoint stays visible in the picker, marked, so its absence is
diagnosable rather than a failed request discovered later.

## Proxying

Every request goes from your browser to this app's server and out to the Endpoint. No
request ever travels browser-to-Endpoint directly, so no Credential is ever inlined into a
request the browser builds or into the client bundle.

One consequence is worth stating plainly: **the security posture here depends on the app
staying local and single-user.** Proxying means the server holds every user's Credential —
fine for one person on their own machine, not for many. Hosting it would need both an
authentication story and a replacement for the key-entry route. If multi-user hosting ever
becomes the goal, that decision should be reopened rather than patched.

## API

Four Route Handlers, **all `POST` by design**. With Cache Components enabled, a `GET` handler
follows the prerender model of a page — so a response varying by Endpoint would be frozen at
build time and every Endpoint would report the same answer. A silent wrong result rather
than a visible failure.

| Route | Purpose |
| --- | --- |
| `POST /api/chat` | Hold a Conversation. Streams a Response back progressively. |
| `POST /api/endpoints` | The Registry, with each Endpoint's configured state. |
| `POST /api/models` | Model Discovery against one Endpoint. |
| `POST /api/keys` | Key Entry. Development only. |

Chat and discovery are deliberately separate seams: discovery fails with a bad address or a
missing Credential, generation fails for entirely different reasons, and collapsing them
would make every failure look like a chat failure.

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
| `pnpm test` | Vitest suite — 288 tests across 26 files. |
| `pnpm typecheck` | `tsc --noEmit`. |
| `pnpm lint` | ESLint. |
| `pnpm test:mutation` | Mutation check on the security-critical paths. |

`.env.local` is gitignored. Credentials entered through the interface are written there and
are never committed.

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
- Tool calling and function invocation; file and image attachment
- Creating arbitrary Endpoints through the interface — the Catalog is source-controlled,
  and no caller-supplied base URL is accepted
- Reasoning-token display and source citations
- Authentication and multi-user support
- Deployment to hosted infrastructure, which would put Local Endpoints out of reach

## Layout

```
app/
  api/{chat,endpoints,keys,models}/   Route Handlers, with tests alongside
  page.tsx                            The Conversation, at the root
components/
  workspace.tsx                       Saved Conversations beside the chat
  conversation-list.tsx               The list of Saved Conversations
  settings.tsx                        Settings, as a dialog over the list
  modal.tsx                           The shell both dialogs sit in
  endpoint-picker, model-picker, key-entry, chat surface, markdown, theme-toggle
lib/
  conversations/                      Store, naming, the hook over both
  endpoints/                          Catalog, Registry, grouping, resolution, validation
  models/                             Discovery, parsing, selection
  selection/                          The Endpoint and Model kept between visits
  theme.ts                            The Theme, and the Preference Store
  env.ts                              The only place a Credential is written
  chat/failure.ts                     Turning provider errors into readable text
scripts/                              Catalog refresh, mutation check
```

`lib/endpoints/catalog.ts` is the highest-leverage file in the repo. It decides where
Credentials are sent and is the most likely to need maintenance as model identifiers shift.
Treat changes to it with the care of a dependency bump, not a copy edit.

## Further reading

- [`GLOSSARY.md`](./GLOSSARY.md) — the domain vocabulary, including which words to avoid
- [`.scratch/multi-endpoint-chatbot/spec.md`](./.scratch/multi-endpoint-chatbot/spec.md) — the
  spec, its decisions and rationale, and what was deliberately left out
- [`AGENTS.md`](./AGENTS.md) and [`docs/agents/`](./docs/agents/) — conventions for working
  in this repo

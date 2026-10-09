<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

A local, single-user chat app that proxies to whichever **Endpoint** (AI backend) the
reader picks. The whole vocabulary — Endpoint, Credential, Turn, Response, Root, Grant,
Tool, Store — is defined in `GLOSSARY.md`, and the terms it lists under *Avoid* are words
not to use in code, comments, tests or issues. Read it before naming anything.

## Commands

Node 20.9+, pnpm 12.3.4 (pinned via `packageManager`). No CI runs these — you are the gate.

| Command | Notes |
| --- | --- |
| `pnpm dev` | Port 3000. `predev` sweeps AppleDouble `._*` files first. |
| `pnpm test` | `vitest run`. Filter one area with `pnpm vitest run lib/roots` or `pnpm vitest run lib/roots/readable.test.ts -t "a name"`. |
| `pnpm typecheck` | `tsc --noEmit`. Needs a prior `pnpm dev` or `pnpm build` in a fresh checkout: the generated `next-env.d.ts` imports `.next/types/routes.d.ts`, which does not exist until Next runs. A new Route Handler joins the generated route union the same way. |
| `pnpm lint` | `eslint` over the whole repo, no path argument. |
| `pnpm test:mutation` | Security gate. See below. |
| `node scripts/refresh-catalog.mjs <models.dev-api.json>` | Regenerates `lib/endpoints/catalog.ts`. Fetch the snapshot with `curl -o /tmp/api.json https://models.dev/api.json` first. Output is reviewed as a diff, never fetched at runtime. |

Run `lint → typecheck → test`, and `test:mutation` as well whenever you touch a file named
at the top of `scripts/mutation-check.sh`.

## Architecture in one screen

Single Next.js app; there is no second package (`pnpm-workspace.yaml` holds only
`allowBuilds`). `app/` is App Router — `app/page.tsx` is the Conversation, `app/api/**` are
Route Handlers, and **every** component in `components/` is a client component. `lib/` holds
all the logic, split by concern: `endpoints/` (Catalog, Registry, resolution), `models/`,
`roots/` (the Reading Root, containment, the walks), `tools/` (the three read-only Tools and
the approval policy), `chat/`, `conversations/`, `selection/`, `env.ts`, `theme.ts`.

Two files carry the repo's risk and deserve dependency-bump care, not copy edits:
`lib/endpoints/catalog.ts` (decides where a Credential is sent) and `lib/roots/readable.ts`
(the one answer to "may the Model read this").

Tailwind v4 has **no config file**. Design tokens live in `tokens.css` and are exposed with
`@theme inline` in `app/globals.css` — use the named utilities (`bg-paper`, `text-ink`,
`border-rule`, `font-display`), not arbitrary values.

## Invariants that look like oversights but are not

- **Every Route Handler is `POST`, and a `GET` would be a bug.** `cacheComponents` is on, so
  a `GET` handler follows the prerender model of a page: a response varying by Endpoint would
  be frozen at build time and every Endpoint would report the same answer.
- **`/api/keys`, `/api/roots` and `/api/endpoints/declared` return 404 outside development.**
  They write `.env.local`, `.reading-root.json` and `.endpoints.json`. `pnpm start` cannot
  exercise them; verify under `pnpm dev`.
- **No filesystem path ever comes from a request.** The Root is read server-side from
  `.reading-root.json`; the chat route takes a *message* and finds paths in it. Do not add an
  attachment list or a `root` field — that is the arbitrary-file-read primitive the schema
  exists to refuse.
- **No base URL comes from a request either.** Catalog addresses are fixed in source and
  `/api/keys` uses `.strict()` so an extra field is refused, not ignored. Declared Endpoints
  take their address from `.endpoints.json`, read by the server at proxy time.
- **`mayRead` in `lib/roots/readable.ts` is the only containment answer.** The three Tools,
  the `@` menu, the pasted-path check and the recheck at send all go through it. Open the
  path it *returns*, never the path that was asked for. A second comparison is a second answer
  to keep in step with the first.
- **`ai@7`: `streamText` must not be awaited; `convertToModelMessages` must be.** And
  `stopWhen: isStepCount(n)` is not optional — `streamText` defaults to one step, so without
  it the Tools never see a result and are inert rather than slow. Keep `abortSignal` wired, or
  Stop leaves the server generating for nobody.
- **Error text may never contain a Credential.** `describeFailure` discards the underlying
  provider error because it echoes the request back.

## Tests

Colocated `*.test.ts(x)` beside the source — no `__tests__`, no separate tree. The suite runs
in the **node** environment by default; a component test opts into jsdom with an
`@vitest-environment jsdom` docblock.

- Anything that touches `.env.local`, `.reading-root.json` or `.endpoints.json` must run
  inside `temporaryProject()` from `lib/testing/temporary-project.ts` (`begin()` in
  `beforeEach`, `end()` in `afterEach`). Writing the developer's real files, or leaking a
  `process.chdir`/`process.env` change, is the failure mode this helper exists to prevent.
- `rejectionFor()` in `lib/testing/history.ts` runs a Saved Conversation through the shipping
  `streamText` path to prove it is still sendable — use it whenever history shape changes.
- `describe`/`it` are written as prose about behaviour ("a Response rendered as formatted
  text"), not as method names. Keep that voice.
- Mutation-check entries aim at **exact source text** via `index`, not a regex. Reformatting a
  guarded line silently turns its entry into `NOT APPLIED`, which reads like the guard drifted.
  If you add a security guard, add an entry, and check the entry's `from` string still matches.

## Working style

Comments here carry real reasoning — what was measured, what was tried and rejected, and why
a load-bearing line is shaped the way it is. Do not trim them when editing nearby code. Write
new ones the same way: prose, and a "why" rather than a restatement.

Commit messages are first person and state the reader's outcome ("I can forget every
Conversation at once, once I have said so"). Match that.

This repo is public. `.env*`, `.reading-root.json`, `.endpoints.json`, `_tmp_*` and their
temp siblings are gitignored and must stay that way.

## Agent skills

### Issue tracker

Issues and specs live as markdown files under `.scratch/<feature>/`. See
`docs/agents/issue-tracker.md` for the full conventions.

`.scratch/` is allowlisted in `.gitignore`: only `spec.md`, `map.md`, and `issues/**` are
committable, and anything else under `.scratch/` is ignored by default. This repo is public, so
anything committed there is permanent. Treat a file as committable only if it is one of those
three artifact types and you have read it back and confirmed it holds no Credential, env dump,
log tail, or transcript. If a throwaway file must be committed, `git add -f` it deliberately.

A ticket carries `**What to build:**` in the reader's voice, a `**Blocked by:**` line, a
`**Status:**` line, a checklist of acceptance criteria, and `## Decisions` / `## Comments`
appended below as work happens.

### Triage labels

Default five-role vocabulary, recorded as `Status:` lines. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

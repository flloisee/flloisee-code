# Spike finding — runtime env reload (ticket 02)

**Question.** After writing a variable to `.env.local`, does the already-running Next.js
dev server see it immediately, or must it restart?

**Answer: NO RESTART IS REQUIRED. Reload works at runtime, synchronously, in the same
request, with one explicit call.**

**Status:** verified by execution, `next dev` (Next.js 16.4.0, Turbopack) and
`next build` + `next start`, Node v24.18.0, macOS.

This contradicts an earlier draft of the spec. That draft was wrong, and this note is the
correction ticket 05 should build on.

---

## Mechanism

```ts
import { loadEnvConfig } from "@next/env";

// dir must be the project root — process.cwd() is correct under both `next dev`
// and `next start` when run from the project directory.
loadEnvConfig(process.cwd(), process.env.NODE_ENV === "development", undefined, true);
//                                                                                  ^^^^ forceReload
```

`forceReload: true` is **required**. Without it:

- `loadEnvConfig` returns a memoised result if it has already run in the process
  (`initialEnv`/cached combinedEnv short-circuit), and
- `processEnv` short-circuits on `process.env.__NEXT_PROCESSED_ENV`, which Next sets on
  its first load.

So a plain `loadEnvConfig(dir)` after Next's own boot is a no-op. `forceReload: true`
bypasses both caches.

### There is no Next.js public API for this

Checked and confirmed: `next` exports no env-reload function. `next/dist/server/next-server.d.ts`
declares `protected loadEnvConfig(...)` — a protected method on `NextServer`, not
reachable from app code. `@next/env` is the only supported route, and Next's own bundled
docs recommend it (`node_modules/next/dist/docs/01-app/02-guides/environment-variables.md`,
section "Loading Environment Variables with `@next/env`").

**`@next/env` was added explicitly to `package.json`** (`"@next/env": "16.4.0"`) — it was
previously only a transitive dep and is not importable without it. This is the intended,
documented usage, not a reach into internals.

## Evidence

Scaffold route: `app/api/spike-env/route.ts` (POST-only, spike scaffolding).

> The scaffold was removed once this finding was recorded, in ticket 05. It wrote
> any variable name to `.env.local` with no development guard and no allowlist —
> exactly the route Key Entry had to be built not to be. What follows is a record
> of how these numbers were obtained, not a procedure that still works.

### Under `next dev`

| # | Action | Result |
|---|---|---|
| 1 | `SPIKE_TEST_VAR` appended to `.env.local` by shell after server was up; read it | `after: "shell-appended-value"`, **same PID, no restart** |
| 2 | Negative control: read a var never written | `after: null` — route is genuinely reading `process.env` |
| 3 | Append a brand-new var, read **in the very next request with no sleep** | `after: null` (miss), then `after: "late-value"` on a request ~2 s later |
| 4 | `write` then read `process.env` **inside the same request**, no reload | `after: null`, `fileContainsVar: true` — file written, `process.env` not updated |
| 5 | `write` then `loadEnvConfig(dir, true, undefined, true)` **inside the same request** | `after: "sameday2"`, `changed: true` — **synchronous, same request, same PID** |
| 6 | 20 consecutive `write+reload` requests, each checking its own value | **HIT=20 MISS=0** |
| 7 | 15 consecutive `write` (no reload) then next request | **HIT=2 MISS=13** — the watcher path is racy |
| 8 | Same as 7 but with a 100 ms / 300 ms / 1 s pause | **8/8, 8/8, 8/8** hits at every delay |

Dev server log shows why 3/7 are racy — Next's own watcher reloads asynchronously:

```
  Reload env: .env.local
 POST /api/spike-env 200 in 8ms
```

That "Reload env: .env.local" line comes from
`node_modules/next/dist/server/lib/router-utils/setup-dev-bundler.js:650-655`, which calls
`propagateServerField(opts, 'loadEnvConfig', [{ dev: true, forceReload: true }])` when a
watched `.env*` file changes. So under `next dev` there **is** a background watcher doing
the reload for you — just not synchronously, and with no completion signal.

### Under `next build` + `next start`

| Action | Result |
|---|---|
| Read a var present at build time | value present |
| Append a brand-new var, read with no reload | `after: null` — **no watcher in production** |
| Same var, `loadEnvConfig(..., forceReload: true)` | `after: "prod-new"`, `changed: true` — **works** |

The watcher is dev-only. Production has **no** automatic reload; the explicit call is the
only mechanism, and it works identically.

## Conditions and caveats

1. **`forceReload: true` is mandatory.** Without it the call is a silent no-op. This is the
   single easiest way to get a wrong answer here — and very plausibly how the earlier
   draft concluded "restart required".

2. **`process.env` is rebuilt from a snapshot, so runtime-only mutations are WIPED.**
   `loadEnvConfig` calls `replaceProcessEnv(initialEnv)` then re-applies file values.
   Verified: set `process.env.SPIKE_STICKY = "set-in-memory"` in one request → visible in
   the next → then touch `.env.local` to trigger the dev watcher → `SPIKE_STICKY` is now
   `null`. Any variable set only in memory at runtime does not survive a reload. Anything
   that must survive has to live in an env file.

3. **Shell environment beats `.env.local`, permanently.** With
   `SPIKE_SHELLVAR=from-shell-env pnpm dev` and `SPIKE_SHELLVAR=from-env-file` in
   `.env.local`, `process.env.SPIKE_SHELLVAR` is `"from-shell-env"` after a forceReload.
   A user who exports the variable in their shell will never see the file's value, and
   Key Entry will appear to have "saved nothing".

4. **The `dev` argument selects the file list.** `loadEnvConfig(dir, true)` in production
   loads `.env.development.local` / `.env.development`, which production should not read.
   Verified: `.env.development.local` was picked up by a `next start` server. Always pass
   `process.env.NODE_ENV === "development"`.

5. **Re-reading the file is not enough.** The file has the value; `process.env` does not.
   Any code path that re-reads `.env.local` directly (fs) instead of going through
   `loadEnvConfig` will diverge from `process.env`.

6. **Client bundle is unaffected.** Only server-side `process.env` is reloaded. This is
   irrelevant for the chatbot (everything is proxied server-side, Credentials are never
   sent to the browser) but would matter for any `NEXT_PUBLIC_*` value.

7. **Duplicate keys:** appending a second `NAME=newvalue` line and reloading does update
   `process.env` to the new value (verified: `SPIKE_OVR2` `aaa` → `bbb`). But a dotenv
   parse takes the last occurrence, so append-only writes that rewrite a value produce a
   file with two entries. Ticket 05 should rewrite the key in place, not append blindly.

8. **Timing caveat, quantified.** Under `next dev`, "no restart needed" is true but
   "the next request sees it" is **not** reliable — 2/15 in testing. Relying on the
   watcher means a user who saves a key and immediately sends a chat message can get one
   turn that misses the Credential.

## Recommendation for ticket 05

**Write the key to `.env.local`, then call `loadEnvConfig(process.cwd(), process.env.NODE_ENV === "development", undefined, true)` in the same request handler, then read the Credential from `process.env` for the rest of that request.**

Do this in one small helper module (e.g. `lib/env.ts`) so the write and the reload cannot
be separated:

```ts
import { loadEnvConfig } from "@next/env";

export function reloadEnv(): void {
  loadEnvConfig(process.cwd(), process.env.NODE_ENV === "development", undefined, true);
}
```

Rationale: 20/20 vs 2/15. It is synchronous, so there is no window in which a user can
act on a stale environment, and it behaves identically under `next dev` and
`next start` — one code path, no dev-only branch.

**No restart prompt is needed.** That fallback is not required.

### Residual risk worth handling anyway

Caveat 2 means the reload is destructive to in-memory-only variables. If ticket 05's
credential resolution ever keeps a resolved key in memory as a cache, that cache must be
invalidated by the same write path, or it will be silently wiped by the reload.

Caveat 3 means the save handler should read back `process.env[name]` after the reload and
**report to the user what value is actually live**, rather than assuming the file is the
source of truth. If a shell export shadows it, saying so is far better than silently
appearing to fail.

## Reproducing

```bash
pnpm dev                                    # POST /api/spike-env {"action":"read","name":"X"}
echo "X=1" >> .env.local                    # then re-read: NOT visible on next request
curl -XPOST .../spike-env -d '{"action":"write+reload","name":"Y","value":"1"}'
#                                            # -> after:"1", changed:true, same PID
```

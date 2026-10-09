# 05: Key entry route

**What to build:** A development-only route that accepts a Cloud Endpoint's Credential, writes it to the environment file, and makes that Endpoint usable on the very next request — no hand-editing a file, no restarting the server.

This is the only place in the app that writes files and secrets, so it is bounded rather than trusted implicitly. Each constraint below closes a specific way this route could become an arbitrary-write or Credential-disclosure endpoint.

**Blocked by:** 02 — Runtime environment reload spike (settles whether a restart is needed), 04 — Catalog-backed Cloud Endpoints (supplies the declared variable names and base URLs this route is constrained against)

**Status:** resolved

- [x] The route refuses to run outside development, so no deployed build contains a secret-writing capability at all
- [x] Only environment variable names the catalog already declares may be written; an undeclared name is rejected
- [x] No base URL is accepted from the request — the catalog supplies it — so an attacker reaching this route could write a known variable's value but could not redirect where it is sent
- [x] The write is atomic, via a temporary file and rename, so an interrupted write cannot corrupt an existing set of keys
- [x] Existing entries, comments, and unrelated variables in the environment file are preserved
- [x] A stored Credential is never returned in any response — the route is write-only
- [x] The environment is reloaded after writing, so the Credential takes effect on the next request
- [x] If ticket 02 found reload does not work, the route instead returns a clear instruction to restart the dev server — *not required: ticket 02 verified the reload works, so there is no restart path to fall back to*
- [x] The environment file remains excluded from version control
- [x] Tests cover each constraint: refuses outside development, rejects an undeclared variable name, ignores a base URL supplied in the request, preserves unrelated entries and comments, never returns a stored value
- [x] A test confirms an interrupted write leaves the previous file intact, since corrupting it would lose every key entered so far

## What was built

`POST /api/keys` (`app/api/keys/route.ts`) and `lib/env.ts`, which does the writing and the reloading in one function so they cannot be separated.

**The request.** `{ "envVar": "OPENROUTER_API_KEY", "credential": "sk-..." }`, and nothing else — the schema is strict, so a field the caller expected to be honoured, a base URL among them, is refused rather than quietly dropped. The variable name must be one the Registry declares (`DECLARED_CREDENTIAL_VARS`, derived from the Catalog and exported from `lib/endpoints/registry.ts`).

**The response.** 200 with `{ "envVar": string, "applied": boolean, "shadowedByShell": boolean }` — the variable name and whether the environment is actually carrying it. Never the Credential. Errors are 400 with a message naming the rule that was broken and never echoing the value.

**What `applied: false` means.** `shadowedByShell: true` says the name is already in the process environment — a shell export — and the loader skips names already present, so the file's value will not win until the export is gone. The Credential is still written down. This is reported rather than assumed, because a save that reports success and changes nothing is the one failure a developer cannot diagnose.

**Four things the reload does, found by measuring rather than by reading:**

- `forceReload: true` is not optional. Without it the call is a silent no-op in any server that has already booted. `app/api/keys/runtime-reload.test.ts` primes the loader the way a boot does, because a test process that has never read the environment would pass even with the argument dropped.
- The reload is destructive: `process.env` is rebuilt from a snapshot, so anything set only in memory is dropped. Nothing caches a resolved Credential; every read goes through `process.env`.
- Values containing `"`, `$`, a line break, or a null are refused. `$` is interpolated on load and `"` is not unescaped, so both come back as something other than what was typed — measured, not assumed.
- The entry is rewritten where it stands, never appended, so the file never holds two entries that disagree.

`scripts/mutation-check.sh` injects each of the eight bugs the constraints exist to prevent and records which test noticed. All eight are caught; without it a security test that passes whether or not the check is there reads as evidence.
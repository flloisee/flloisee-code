# 05: Key entry route

**What to build:** A development-only route that accepts a Cloud Endpoint's Credential, writes it to the environment file, and makes that Endpoint usable on the very next request — no hand-editing a file, no restarting the server.

This is the only place in the app that writes files and secrets, so it is bounded rather than trusted implicitly. Each constraint below closes a specific way this route could become an arbitrary-write or Credential-disclosure endpoint.

**Blocked by:** 02 — Runtime environment reload spike (settles whether a restart is needed), 04 — Catalog-backed Cloud Endpoints (supplies the declared variable names and base URLs this route is constrained against)

**Status:** ready-for-agent

- [ ] The route refuses to run outside development, so no deployed build contains a secret-writing capability at all
- [ ] Only environment variable names the catalog already declares may be written; an undeclared name is rejected
- [ ] No base URL is accepted from the request — the catalog supplies it — so an attacker reaching this route could write a known variable's value but could not redirect where it is sent
- [ ] The write is atomic, via a temporary file and rename, so an interrupted write cannot corrupt an existing set of keys
- [ ] Existing entries, comments, and unrelated variables in the environment file are preserved
- [ ] A stored Credential is never returned in any response — the route is write-only
- [ ] The environment is reloaded after writing, so the Credential takes effect on the next request
- [ ] If ticket 02 found reload does not work, the route instead returns a clear instruction to restart the dev server
- [ ] The environment file remains excluded from version control
- [ ] Tests cover each constraint: refuses outside development, rejects an undeclared variable name, ignores a base URL supplied in the request, preserves unrelated entries and comments, never returns a stored value
- [ ] A test confirms an interrupted write leaves the previous file intact, since corrupting it would lose every key entered so far

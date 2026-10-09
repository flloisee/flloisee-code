# 02: Spike — confirm environment reload at runtime

**What to build:** A written answer to one question: after writing a Credential to the environment file, does the running server process pick it up immediately, or must it restart?

This is a spike, not user-visible behaviour. It exists because the whole key-entry path depends on the answer, and the assumption has already been wrong once — an earlier draft of the spec asserted a restart was unavoidable, which was incorrect.

**Blocked by:** None (can start immediately)

**Status:** resolved

- [x] The framework's environment loader is invoked at runtime and confirmed to replace the running process's environment in place
- [x] Confirmed by execution, not by reading the export's signature or documentation — reading the signature is what produced the earlier wrong answer
- [x] A variable written to the environment file is readable by a subsequent request without a dev server restart
- [x] The behaviour is checked under `next dev`, which is how this app is actually run; if it differs under `next build`/`start`, that difference is recorded
- [x] The finding is written down, including any conditions under which it stops holding
- [x] If reload does not work, the fallback is recorded too: a clear in-interface prompt to restart, since ticket 05 depends on this answer

## Finding

**No restart is required.** `loadEnvConfig(process.cwd(), dev, undefined, /* forceReload */ true)`
replaces `process.env` in place, synchronously, inside the running request — verified under
both `next dev` and `next build` + `next start` on Next.js 16.4.0.

The earlier draft's claim was wrong. **Ticket 05 does NOT need a restart prompt.**

Mechanism, evidence, caveats and the recommended shape are in
[`docs/spikes/02-runtime-env-reload.md`](../../../docs/spikes/02-runtime-env-reload.md).

Headlines:

- `forceReload: true` is mandatory — without it the call is a silent no-op (memoised
  result + `__NEXT_PROCESSED_ENV` short-circuit).
- `@next/env` was added explicitly to `package.json`; Next exposes no public API for this.
- Under `next dev` there is an async file watcher that reloads for you, but it is
  **racy**: 2/15 next-request reads saw the new value. Explicit reload in the same request
  was 20/20.
- The reload **wipes runtime-only `process.env` mutations** and **shell env vars permanently
  shadow `.env.local`**. Both matter for Key Entry's UX.

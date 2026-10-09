import { randomBytes } from "node:crypto";

/**
 * The secret an approval request is signed with.
 *
 * **What it is for.** The browser resends the whole message history each Turn, so
 * without a signature a caller could edit one approval — approving a read of
 * `~/.ssh/id_rsa` the server never asked anyone about — and have the replayed
 * history treated as the server's own decision. The SDK signs each approval
 * request as it is issued and verifies the signature when the history is replayed,
 * so a request that did not come from this server is refused rather than obeyed.
 * The check is fail-closed: a missing signature and a wrong one are both errors,
 * not warnings.
 *
 * **Why it is generated rather than configured.** It is not a secret anyone
 * holds. Its whole job is to answer "did this server issue this question?", so
 * anything a reader could set, copy or leak would answer a different and weaker
 * question, and a value in the environment is a value that ends up in a process
 * listing and a deploy log.
 *
 * **Once per process, not once per request.** Signatures are checked on later
 * Turns, so a fresh value each time would refuse every approval the reader had
 * just been asked. That does mean a module reload under Turbopack invalidates an
 * approval in flight — the reader is asked the same question a second time. That
 * is the correct failure rather than a bug to engineer around: re-asking is what
 * happens when the server cannot prove the question was its own.
 *
 * Held behind a function rather than a module constant so that importing this
 * file has no effect until something actually needs a signature.
 */
let secret: string | null = null;

export function toolApprovalSecret(): string {
  secret ??= randomBytes(32).toString("hex");
  return secret;
}
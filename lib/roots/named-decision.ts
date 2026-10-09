/**
 * What the reader decided about a path they named, held by the server until the
 * next send.
 *
 * The composer asks before the Turn exists, and the check happens again at send —
 * and it has to happen again on the server, because the browser's answer is not
 * evidence of anything. So the answer has to travel somewhere the browser cannot
 * write to, and this is somewhere.
 *
 * **In this process, and in no file.** Three things follow, and all three are the
 * point:
 *
 * - Nothing here survives a restart, so an allowance cannot outlive the message it
 *   was given for. The same posture the approval signing secret already takes: a
 *   value that changes under the reader mid-Turn costs one press, and re-asking is
 *   the correct failure.
 * - Nothing here can be written by the browser. Only `/api/roots` calls
 *   {@link decide}, and that route refuses to run outside development — the same
 *   guard that keeps a deployed build from declaring a Root. That is what stops
 *   this from being the arbitrary-file-read primitive `/api/chat` refuses to be:
 *   a caller who can post to it cannot mint a decision, and a caller who can mint
 *   a decision is the reader's own interface in development.
 * - {@link takeDecisions} empties the record. "Allow once" means once, and the
 *   only way to mean that is for the answer to be spent by the send it was given
 *   for. A reader who wants it to last presses the other button, which writes a
 *   Grant that does survive.
 *
 * Keyed by the path **as the reader wrote it**, never by anything worked out on
 * disk. The recogniser is the same function on both sides, so the string the
 * composer asked about is the string the send looks up; a key derived from the
 * server would let one answer be found under a spelling the reader was never
 * shown.
 */

/** One reader's answer about one path, for one send. */
export type Decision = "allowed" | "denied";

/**
 * The answers waiting to be spent, keyed by the path they were given for.
 *
 * Module state, and deliberately so: this is the one fact in the feature that has
 * to be shared between two Route Handlers in one process and must not be shared
 * between two machines. A file would be the wrong shape for both halves of that.
 */
let pending = new Map<string, Decision>();

/** The reader allowed this path for the next send, or refused it. */
export function decide(asked: string, decision: Decision): void {
  pending.set(asked, decision);
}

/**
 * Every answer waiting, and none of them after this.
 *
 * Read and clear in one call rather than two, because the clearing is what makes
 * the decision true once and a reader who pressed two buttons in a row is not two
 * readers. It is called once per send, before the recheck, so a Turn is decided
 * by the answers that were on the books when it arrived and not by anything that
 * landed while it was being checked.
 */
export function takeDecisions(): ReadonlyMap<string, Decision> {
  const answered = pending;
  pending = new Map();
  return answered;
}

/**
 * Forgets every answer, for a test that has to start from nothing.
 *
 * Module state is not reset between test files, so a test that records a decision
 * and a later test that expects no decisions would otherwise be at the mercy of
 * the order vitest happened to run them in.
 */
export function clearDecisions(): void {
  pending = new Map();
}
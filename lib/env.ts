import { promises as fs } from "node:fs";
import path from "node:path";

import { loadEnvConfig } from "@next/env";

import { writeAtomically, type TempFileWriter } from "@/lib/atomic-write";

/**
 * The one place in the app that writes a Credential, and the one place the
 * environment can change underneath a running server.
 *
 * Writing and reloading live in a single function on purpose. Next's own dev
 * watcher reloads the environment when it notices `.env*` changed, but it fires
 * asynchronously with no completion signal: measured, a write followed by the
 * next request had the new value 2 times in 15. There is no watcher at all
 * under `next start`. So a caller that wrote in one place and reloaded in
 * another would have a window in which the developer believes the Credential is
 * stored and the server still disagrees. `saveAndReloadEnvValue` makes that
 * window unrepresentable.
 */

/** Where Credentials go: the file Next reads last under `next dev`. */
export const ENV_FILE = ".env.local";

/**
 * The temporary file's name, inside the same directory as the file it replaces.
 *
 * Not named `.env*`, because a name Next watches would trigger its asynchronous
 * reload in the middle of ours — one that reads the old file, and could land
 * after our own reload and undo it.
 */
const tempName = `.key-entry-${process.pid}.tmp`;

export type { TempFileWriter };

/**
 * Whether a value can be stored in the environment file and read back as itself.
 *
 * Five characters cannot, and each was measured against the installed loader
 * rather than reasoned about:
 *
 * - `\n` and `\r` end the entry, so what follows becomes a second assignment.
 * - `"` cannot be represented: the file holds `\"`, and the loader does not undo
 *   that escape, so the value comes back with the backslash still in it.
 * - `$` is interpolated against the process environment on load, so
 *   `sk-$USER` is read back as whatever `USER` happens to be.
 * - `\0` truncates: `a\0b` was measured coming back as `a`, the loader stopping
 *   at the null byte. No Credential contains one; it is refused rather than
 *   silently shortened.
 *
 * The last three are the dangerous ones, because a Credential that does not
 * survive the round trip is stored and looks stored, and then fails at the
 * Endpoint with nothing to connect it to what was typed. Refusing is the honest
 * answer; an API key containing none of these is the ordinary case, and one that
 * does can still be set in the developer's own environment.
 */
const CANNOT_BE_STORED = /["$\r\n\0]/;

export function canBeStoredVerbatim(value: string): boolean {
  return !CANNOT_BE_STORED.test(value);
}

/**
 * Quotes a value only when it would otherwise be misread.
 *
 * Whitespace and `#` are safe to quote — both survive a quoted round trip
 * exactly — and a Credential is opaque text that may well contain either. No
 * escaping happens here because there is nothing to escape: a value holding a
 * character the file cannot represent is refused before it reaches this point.
 */
function renderValue(value: string): string {
  const isBare = value.length > 0 && !/[\s#]/.test(value);
  return isBare ? value : `"${value}"`;
}

/** One assignment, tolerating the `export` form dotenv also accepts. */
function assignmentFor(name: string, value: string): string {
  return `${name}=${renderValue(value)}`;
}

/** Matches the leading `export` on an assignment, if it carries one. */
function exportPrefixOf(line: string): string {
  const match = /^\s*(export\s+)/.exec(line);
  return match ? match[1] : "";
}

/**
 * The comment trailing an assignment, if it has one.
 *
 * dotenv drops everything from an unquoted `#` onwards, so a note written after
 * a key is not part of the value and survives the rewrite intact. A `#` inside
 * a quoted value is not a comment, but that only matters for the value being
 * replaced anyway.
 */
function trailingCommentOf(line: string): string {
  const hash = line.indexOf("#");
  return hash === -1 ? "" : line.slice(hash).replace(/\s+$/, "");
}

function isAssignmentTo(line: string, name: string): boolean {
  return new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=`).test(line);
}

/**
 * Returns `contents` with `name` set to `value`, everything else untouched.
 *
 * Rewrites the assignment where it stands rather than appending: a dotenv parse
 * takes the last occurrence, so an append leaves two entries that disagree, and
 * the file then reads as though the Credential were stored twice. Any duplicate
 * assignments for the same name are folded into the first, since a second entry
 * is never what anyone meant.
 *
 * Comments, blank lines, ordering, quoting, and every other variable are
 * preserved as written — including a note left beside the Credential itself.
 * A developer's `.env.local` is theirs to annotate, and a Key Entry that quietly
 * tidied it up would be a Key Entry that quietly discarded someone's reminder.
 */
export function setEnvValue(contents: string, name: string, value: string): string {
  const endsWithNewline = contents.length === 0 || contents.endsWith("\n");
  const lines = contents.split("\n");

  // A trailing newline yields a final empty element; drop it so a rewrite does
  // not accumulate blank lines, and re-add it at the end.
  if (endsWithNewline) lines.pop();

  const firstIndex = lines.findIndex((line) => isAssignmentTo(line, name));

  if (firstIndex === -1) {
    lines.push(assignmentFor(name, value));
  } else {
    const comment = trailingCommentOf(lines[firstIndex]);
    const line = exportPrefixOf(lines[firstIndex]) + assignmentFor(name, value);
    lines[firstIndex] = comment ? `${line}  ${comment}` : line;

    for (let index = lines.length - 1; index > firstIndex; index -= 1) {
      if (isAssignmentTo(lines[index], name)) lines.splice(index, 1);
    }
  }

  return lines.join("\n") + (endsWithNewline ? "\n" : "");
}

/**
 * Re-reads the environment files and replaces the process environment.
 *
 * `forceReload: true` is not optional. `loadEnvConfig` memoises its result and
 * short-circuits on `process.env.__NEXT_PROCESSED_ENV`, which Next sets on its
 * own first load — so without it this call is a silent no-op, and the value
 * stays stale with nothing to show for it. Next exposes no public equivalent;
 * `NextServer.loadEnvConfig` is protected. `@next/env` is the documented route.
 *
 * `dev` picks which files are read. Passing `true` under `next start` would
 * load `.env.development.local`, which production should never see.
 *
 * The replacement is destructive: `process.env` is rebuilt from a snapshot
 * taken at first load, so anything set only in memory is dropped. That is why
 * every Credential is read from `process.env` per request rather than cached.
 */
export function reloadEnv(dir: string): void {
  loadEnvConfig(dir, process.env.NODE_ENV === "development", undefined, true);
}

/**
 * What the process environment actually holds after a save.
 *
 * Reported rather than assumed. A variable exported in the shell shadows the
 * file permanently — the loader skips names already present — so a save can
 * look like it did nothing, and the useful answer is which value is live.
 */
export type EnvSaveOutcome = {
  envVar: string;
  /** Whether the environment now carries what was just written. */
  applied: boolean;
  /** Whether the process environment is serving a different value than the file. */
  shadowedByShell: boolean;
};

export type SaveEnvValue = {
  name: string;
  value: string;
  /** The project root: where the environment files are, and what gets reloaded. */
  dir: string;
  writeTempFile?: TempFileWriter;
};

/**
 * Writes one Credential and reloads the environment with it, in one call.
 *
 * The caller gets back what is live, never what was written: the stored value
 * is not part of any of this.
 */
export async function saveAndReloadEnvValue(input: SaveEnvValue): Promise<EnvSaveOutcome> {
  const { name, value, dir } = input;
  const target = path.join(dir, ENV_FILE);

  const existing = await fs.readFile(target, "utf8").catch(() => "");
  const updated = setEnvValue(existing, name, value);

  await writeAtomically({
    target,
    contents: updated,
    tempName,
    ...(input.writeTempFile ? { writeTempFile: input.writeTempFile } : {}),
  });

  reloadEnv(dir);

  const live = process.env[name];
  const applied = live === value;

  return { envVar: name, applied, shadowedByShell: !applied && Boolean(live) };
}
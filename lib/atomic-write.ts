import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Replacing a file on disk so that a reader never sees half of it.
 *
 * One implementation, shared by everything that writes a file the app then
 * reads: the environment file a Credential goes in, and the Reading Root file.
 * Two copies of this would be two chances to write in place by accident, and the
 * cost of that is not a corrupt file — it is a file that reads as something it
 * is not, which for either of these two is the difference between a stored
 * Credential and a whole machine's worth of files.
 *
 * The temporary file is written beside the target and renamed over it, because
 * `rename` is atomic only within one filesystem. The caller names it, because
 * what a temporary file may be called is not the same question for both callers:
 * the environment file's must not be named `.env*`, or Next's own watcher fires
 * on it and reloads the environment out from under the write.
 */

/**
 * How the temporary file is written. Overridable so a test can fail a write part
 * way through, which is the interruption this exists to survive.
 */
export type TempFileWriter = (tempPath: string, contents: string) => Promise<void>;

/** Owner-only: everything this app writes is something only its reader may read. */
const writeTempFile: TempFileWriter = (tempPath, contents) =>
  fs.writeFile(tempPath, contents, { encoding: "utf8", mode: 0o600 });

export type AtomicWrite = {
  /** The file being replaced. */
  target: string;
  /** What it should hold once the write has landed. */
  contents: string;
  /** The temporary file's name, which sits in the target's own directory. */
  tempName: string;
  /** Replaces the default writer, so a test can interrupt the write. */
  writeTempFile?: TempFileWriter;
};

/**
 * Writes to a temporary path and renames it over the target.
 *
 * Rename is the atomic step: what a reader sees is either the previous contents
 * or the new ones, never a half-written file. An interrupted write leaves the
 * previous file intact and readable, and the temporary file is removed on the way
 * out so a failed save leaves nothing behind that could be committed or read.
 */
export async function writeAtomically({
  target,
  contents,
  tempName,
  writeTempFile: writer = writeTempFile,
}: AtomicWrite): Promise<void> {
  const tempPath = path.join(path.dirname(target), tempName);

  try {
    await writer(tempPath, contents);
    await fs.rename(tempPath, target);
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch(() => {});
    throw error;
  }
}
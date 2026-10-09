import { promises as fs } from "node:fs";
import path from "node:path";

import { writeAtomically, type TempFileWriter } from "@/lib/atomic-write";

/**
 * The Reading Root: the folder on this machine the Model is allowed to read, and
 * the paths the reader has granted beyond it.
 *
 * It is held in a file of the app's own rather than in the browser, and that is
 * the whole security argument of the feature in one sentence. The browser
 * resends the whole message history each Turn and can post anything to the
 * app's own routes, so a Root held in the browser is a Root something in the
 * browser can pre-approve. Here, changing what the app will read takes a
 * request the server itself has to agree to.
 *
 * The file sits beside `.env.local` because that is where this app already keeps
 * the one thing it must not commit, and because a reader who has been told where
 * the environment file is has been told where this is.
 */

/** The file the Root and its Grants are held in. */
export const ROOT_FILE = ".reading-root.json";

/**
 * The temporary file's name. Not `.env*`, which Next watches: a name it watches
 * would fire its reload in the middle of this write.
 */
const tempName = `.reading-root-${process.pid}.tmp`;

/**
 * What the file says, read as strictly as it can be.
 *
 * `malformed` is kept rather than folded into "no Root" so the reader can be
 * told the file exists and could not be understood. A Root that reads as none
 * with no explanation is a Root that silently stops being read.
 */
export type ReadingRoot = {
  /** The folder the Model may read, or `null` when none has been declared. */
  root: string | null;
  /** Paths the reader has allowed beyond the Root. */
  grants: string[];
  /** The file is there and is not something this app wrote. */
  malformed: boolean;
};

const NO_ROOT: ReadingRoot = { root: null, grants: [], malformed: false };

/** Every shape the file can hold that is not a Root. */
function isUnreadable(parsed: unknown): boolean {
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return true;

  const { root, grants } = parsed as { root?: unknown; grants?: unknown };

  // Absolute, or the Root would be a different folder depending on which
  // directory the server was started in — which is the same file meaning two
  // different things, which is what `malformed` exists to prevent.
  if (typeof root !== "string" || !path.isAbsolute(root)) return true;
  if (grants !== undefined && !Array.isArray(grants)) return true;
  if (Array.isArray(grants) && !grants.every((grant) => typeof grant === "string")) return true;

  return false;
}

/**
 * What the app has been told it may read.
 *
 * A missing file is not an error and not a failure to parse: it is the ordinary
 * state of a machine on which no Root has been declared, and the app opens
 * exactly as it did before this feature existed.
 *
 * A file that cannot be read or understood is neither of those. It reads as no
 * Root — the narrow answer, never the wide one — and says so, because a reader
 * who has declared a Root and found it quietly not applied deserves to know
 * there is a file in the way.
 */
export async function readReadingRoot(dir: string): Promise<ReadingRoot> {
  const contents = await readRootFile(dir);
  if (contents === "absent") return NO_ROOT;
  if (contents === "unreadable") return { ...NO_ROOT, malformed: true };

  const parsed = parseRootFile(contents);
  if (parsed === null) return { ...NO_ROOT, malformed: true };

  return { root: parsed.root, grants: parsed.grants, malformed: false };
}

type RootFile = { root: string; grants: string[] };

async function readRootFile(dir: string): Promise<string | "absent" | "unreadable"> {
  try {
    return await fs.readFile(path.join(dir, ROOT_FILE), "utf8");
  } catch (error) {
    // Only the file not being there is the ordinary case. Anything else — a
    // permission, a directory where the file should be — is a machine in a
    // state the reader has to hear about rather than one to be told all is well.
    return isMissing(error) ? "absent" : "unreadable";
  }
}

function isMissing(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === "ENOENT";
}

/** The file's contents as a Root, or `null` when they are not one. */
function parseRootFile(contents: string): RootFile | null {
  let parsed: unknown;

  try {
    parsed = JSON.parse(contents) as unknown;
  } catch {
    return null;
  }

  if (isUnreadable(parsed)) return null;
  const { root, grants = [] } = parsed as { root: string; grants?: string[] };
  return { root, grants };
}

/**
 * Writes the file from a whole Root, which every writer here is.
 *
 * One place, so that "what this file holds" is one question: a second renderer
 * would be a second answer to it, and the answer is what every later containment
 * check is made against. Grants are sorted and de-duplicated, so the file reads
 * in the same order twice and granting the same path twice records it once.
 */
async function writeRootFile(
  dir: string,
  root: string,
  grants: string[],
  writeTempFile?: TempFileWriter,
): Promise<void> {
  const contents = `${JSON.stringify({ root, grants: [...new Set(grants)].sort() }, null, 2)}\n`;

  await writeAtomically({
    target: path.join(dir, ROOT_FILE),
    contents,
    tempName,
    ...(writeTempFile ? { writeTempFile } : {}),
  });
}

export type DeclareRoot = {
  /** The project root: where the file sits. */
  dir: string;
  /** The folder to record, already resolved and admitted. */
  root: string;
  /** Replaces the temporary file's writer, so a test can interrupt the write. */
  writeTempFile?: TempFileWriter;
};

/**
 * Records a Root, atomically.
 *
 * Grants are carried across rather than replaced: changing which folder the
 * Model reads is not the reader revoking what they have already allowed, and
 * quietly dropping a Grant because someone pointed the Root somewhere else
 * would turn a later refusal into one the reader had never been asked about.
 */
export async function declareRoot({ dir, root, writeTempFile }: DeclareRoot): Promise<void> {
  const current = await readReadingRoot(dir);

  await writeRootFile(dir, root, current.grants, writeTempFile);
}

/**
 * Forgets the Root, leaving no file behind.
 *
 * The whole file rather than only the Root in it. A Grant names a path on this
 * machine and means nothing without a Root to reach from, so keeping one would
 * be keeping a record of a decision that can no longer be acted on — and the
 * reader asking to remove the capability should not be left with the leftover of
 * it on disk.
 */
export async function forgetRoot({ dir }: { dir: string }): Promise<void> {
  await fs.rm(path.join(dir, ROOT_FILE), { force: true });
}

export type GrantPath = {
  /** The project root: where the file sits. */
  dir: string;
  /** The path to admit, already resolved and checked to lie outside the Root. */
  path: string;
  /** Replaces the temporary file's writer, so a test can interrupt the write. */
  writeTempFile?: TempFileWriter;
};

/**
 * Records a Grant: a path the reader has allowed the Model to read anyway.
 *
 * Additive and idempotent. Granting the same path twice records it once, because
 * a list that grows every time the reader answers "always" would say something
 * about how often they answered rather than about what they allowed.
 *
 * A Grant needs a Root to be an addition to, and `grantPath` refuses without one
 * rather than writing an entry nothing will ever read — see `mayRead`.
 */
export async function grantPath({ dir, path: granted, writeTempFile }: GrantPath): Promise<void> {
  const current = await readReadingRoot(dir);
  if (current.root === null) return;

  await writeRootFile(dir, current.root, [...current.grants, granted], writeTempFile);
}

export type RevokeGrant = {
  /** The project root: where the file sits. */
  dir: string;
  /** The recorded path to take back, exactly as the file holds it. */
  path: string;
  /** Replaces the temporary file's writer, so a test can interrupt the write. */
  writeTempFile?: TempFileWriter;
};

/**
 * Takes a Grant back out.
 *
 * Compared exactly, and never normalised first. The paths in the file are the
 * resolved ones, and a path that resolves to a string the file does not hold is
 * not a Grant — it is a name. Resolving before comparing would let a caller
 * remove a Grant by naming something that merely points at the same place, which
 * is a way of editing the boundary without naming it.
 *
 * Removes one and writes even when the path was not there, so that the answer
 * the reader is shown is the file as it now stands rather than an error about a
 * path they can no longer see listed.
 */
export async function revokeGrant({ dir, path: revoked, writeTempFile }: RevokeGrant): Promise<void> {
  const current = await readReadingRoot(dir);
  if (current.root === null) return;

  await writeRootFile(
    dir,
    current.root,
    current.grants.filter((grant) => grant !== revoked),
    writeTempFile,
  );
}
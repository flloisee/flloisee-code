import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { admitUnder, type Refusal } from "./containment";

/**
 * Walking folders for a reader who cannot type a path.
 *
 * This is the only thing in the app that answers "what is in this folder", and
 * it answers it about the reader's own machine. So it carries two constraints
 * rather than one.
 *
 * The first is that it only ever goes where the walk is allowed to go, which is
 * the reader's home folder. Not the whole disk: a route that lists any directory
 * it is handed is a route that hands its caller a map of the machine, and the
 * caller is a browser. Every path it is given goes through the same containment
 * the rest of the feature is stood on, rather than a check of its own, so there
 * is one answer to "is this path ours" in the app and not two.
 *
 * The second is that it never puts a Credential's name in front of the browser.
 * An entry here is a row the reader can click and declare as the Root, so
 * listing `.env.local` would be offering a Credential as the folder the Model may
 * read.
 */

/** A row in a listing: what it is called, and where it really is. */
export type WalkEntry = {
  name: string;
  path: string;
  kind: "directory" | "file";
};

export type WalkListing = {
  ok: true;
  /** The folder that was listed, resolved, so the reader can name it back. */
  path: string;
  /** The way back up, or `null` when there is nowhere up to go. */
  parent: string | null;
  entries: WalkEntry[];
};

export type WalkRefusal = Refusal | "not-a-directory";

export type Walk = WalkListing | { ok: false; reason: WalkRefusal };

/**
 * The folder the walk starts at, and the edge of what it may show.
 *
 * The reader's home folder, because that is where a developer's projects are and
 * it is the widest folder that can be said to contain all of them. The app's own
 * directory would be narrower and would hide every project it is not itself in.
 *
 * Read per call rather than once at import, so the boundary belongs to the
 * process asking rather than to whichever process loaded the module.
 */
export function walkBoundary(): string {
  return os.homedir();
}

/**
 * Names that are never listed, whatever kind of entry they are.
 *
 * `.env` and everything shaped like it, which is every file Next reads
 * credentials and settings from. A symlink with such a name is skipped too: it
 * is the name in the listing, not what it points at, that a reader clicks.
 *
 * Deliberately not a rule about all dotfiles. `.github` is a folder in almost
 * every project and hiding it would be a listing that lies about what is there.
 */
function isSkipped(name: string): boolean {
  return name.startsWith(".env");
}

function byKindThenName(a: WalkEntry, b: WalkEntry): number {
  if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
  return a.name.localeCompare(b.name);
}

async function entriesIn(folder: string): Promise<WalkEntry[] | null> {
  const names = await fs.readdir(folder).catch(() => null);
  if (names === null) return null;

  const entries: WalkEntry[] = [];

  for (const name of names) {
    if (isSkipped(name)) continue;

    const entryPath = path.join(folder, name);

    // Asked of each entry rather than of the listing as a whole: `readdir` says
    // nothing about what an entry is, and a link to a folder has to count as one
    // or the reader can see a folder in the listing and fail to walk into it.
    const entry = await statEntry(entryPath);

    // A name that cannot be read — a broken link, a permission — is left out
    // rather than shown and then refused. A row that cannot be opened is a row
    // that wastes the reader's click.
    if (entry === null) continue;

    entries.push({ name, path: entryPath, kind: entry });
  }

  return entries.sort(byKindThenName);
}

/** `directory` or `file`, or `null` for an entry that cannot be read at all. */
async function statEntry(entryPath: string): Promise<WalkEntry["kind"] | null> {
  try {
    const stats = await fs.stat(entryPath);
    return stats.isDirectory() ? "directory" : "file";
  } catch {
    return null;
  }
}

/**
 * The way back up, when going up stays inside the boundary.
 *
 * A row rather than a path handed over, because the reader clicks it and this
 * is no different from any other entry. `null` at the boundary: there is nothing
 * above it that this walk is allowed to show.
 */
async function parentOf(folder: string): Promise<string | null> {
  const up = path.dirname(folder);
  const admitted = await admitUnder([walkBoundary()], up);
  return admitted.admitted ? admitted.path : null;
}

/**
 * Lists a folder, if this walk is allowed to list it.
 *
 * Every path it is given is admitted before it reaches the disk, including the
 * way back up, so there is no path into this function that reaches a filesystem
 * call unchecked.
 */
export async function listDirectory(target: string): Promise<Walk> {
  const boundary = walkBoundary();

  const admitted = await admitUnder([boundary], target);
  if (!admitted.admitted) return { ok: false, reason: admitted.reason };

  const entries = await entriesIn(admitted.path);
  if (entries === null) return { ok: false, reason: "not-a-directory" };

  return {
    ok: true,
    path: admitted.path,
    parent: await parentOf(admitted.path),
    entries: entries ?? [],
  };
}
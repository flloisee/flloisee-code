import { promises as fs } from "node:fs";
import path from "node:path";

import { admitUnder } from "./containment";
import { isNeverWalked } from "./scan";
import { walkBoundary } from "./walk";

/**
 * Turning the name a folder dialog gives into somewhere on this machine.
 *
 * **The dialog is the reader's operating system's, and it gives a name.**
 * `File.path` was removed from Chrome in v61 as a privacy fix and nothing has
 * put it back; `<input webkitdirectory>` gives `webkitRelativePath`, which is
 * the shape of a path with the root missing; and `showDirectoryPicker()` gives a
 * `FileSystemDirectoryHandle` whose `.name` is the folder's name. So no browser
 * folder picker can return an absolute path, and this module is the answer to
 * what happens instead: the reader picks, and the *server* works out where that
 * name really is.
 *
 * That is not a limitation worked around. It is the whole reason this boundary
 * holds — the Root is recorded on the server and every path is resolved and
 * checked there, so the strongest claim the reader-visible design can make is
 * that the browser never asserts a location. A picker that returned a path would
 * be a weaker design wearing a faster one.
 *
 * Which is why the answer here is a **list of paths the reader confirms**, and
 * never a silent resolution. A reader who picked `/Volumes/External/Projects` —
 * on a volume that is not mounted, so the app cannot reach it — and who has a
 * `Projects` in their home folder would otherwise be given the second one, and
 * told nothing. Showing the path first is what makes that impossible.
 */

/** How many folders one search will go into, however many it is asked about. */
export const MAX_LOCATE_FOLDERS = 1_000;

/** How many folders of the same name one search will offer before stopping. */
export const MAX_LOCATE_MATCHES = 25;

/**
 * The longest a single folder name can be, in characters.
 *
 * The filesystems this runs on cap one path component at 255 bytes, so a name
 * longer than this could not be a folder's name at all. It is refused because
 * there is nothing it could mean rather than because it is large — which is also
 * what stops the search being handed a string long enough to be worth walking a
 * filesystem with.
 */
const MAX_NAME_CHARS = 255;

/** One folder the search found, named in full. */
export type LocatedMatch = { path: string };

/**
 * Why a name was not searched for.
 *
 * Not a `Refusal` from containment, because none of those are questions about a
 * name: this is the one case where the caller sent something that was never a
 * path in the first place.
 */
export type LocateRefusal = "not-a-name";

export type Located =
  | {
      ok: true;
      matches: LocatedMatch[];
      /**
       * Whether the search reached the end of the home folder.
       *
       * `false` once a ceiling stopped it, and that is not a formality: with one
       * match and `complete: false` the app does not know whether that is the
       * only one, and must not present it as though it were.
       */
      complete: boolean;
    }
  | { ok: false; reason: LocateRefusal };

/**
 * Finds the folders in the reader's home folder carrying one name.
 *
 * **Breadth-first, and that is the point of it.** A developer's projects sit one
 * or two folders down, while the volume on a Mac is `~/Library`, which holds tens
 * of thousands of things and is next to none of them. A search that went as deep
 * as it could would spend its whole ceiling inside a cache directory and report
 * a folder it never reached; breadth-first spends it on `~/Documents/projects`
 * and `~/code/app` first, which is where the answer is.
 *
 * **Every candidate is admitted before it can become an answer**, through the
 * same `admitUnder` every other path in this feature goes through — one answer
 * to "is this path ours" in the app, rather than a second rule written here that
 * could disagree with it.
 *
 * **A link is offered but never walked.** A reader may well have picked a link,
 * and if it points somewhere inside their home folder then it really is the
 * folder they meant; admitting it answers with where it *really* is, which is
 * the honest answer and is what the confirmation step exists to show them. But
 * the search never descends into one, which is what keeps a link pointing out of
 * home — or a link pointing at its own parent — from leading the search anywhere
 * at all.
 */
export async function locateFolder(name: string): Promise<Located> {
  if (refusesAsName(name)) return { ok: false, reason: "not-a-name" };

  const boundary = walkBoundary();

  const start = await admitUnder([boundary], boundary);
  // A home folder that cannot be resolved has no extent to search, so this is
  // not "nothing is called that" — it is "the search did not happen", and the
  // one flag that says so is `complete`.
  if (!start.admitted) return { ok: true, matches: [], complete: false };

  const matches: LocatedMatch[] = [];
  const queue: string[] = [start.path];

  let entered = 0;
  let stopped = false;

  // `taken` walks the queue while the queue grows behind it, which is breadth
  // without the cost of shifting an array on every folder.
  for (let taken = 0; taken < queue.length && !stopped; taken += 1) {
    if (entered >= MAX_LOCATE_FOLDERS) {
      stopped = true;
      break;
    }
    entered += 1;

    const entries = await fs.readdir(queue[taken], { withFileTypes: true }).catch(() => null);
    // A folder that will not open is passed over rather than refused: one
    // unreadable folder is one folder of the answer missing, and it is not a
    // reason to refuse to look through the rest of the reader's home folder.
    if (entries === null) continue;

    for (const entry of [...entries].sort(byName)) {
      if (isNeverWalked(entry.name)) continue;

      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;

      const candidate = await admitUnder([boundary], path.join(queue[taken], entry.name));
      if (!candidate.admitted) continue;

      if (entry.name === name) matches.push({ path: candidate.path });

      if (matches.length >= MAX_LOCATE_MATCHES) {
        stopped = true;
        break;
      }

      if (entry.isDirectory()) queue.push(candidate.path);
    }
  }

  return { ok: true, matches, complete: !stopped };
}

/**
 * Whether this is a name rather than a path wearing one.
 *
 * **The browser is allowed to send one name and nothing else**, and this is the
 * place that says so. A caller that could send `../../etc` would be sending a
 * path with exactly the authority the feature was built to withhold from it —
 * not through the walk, which admits every path, but through a string that
 * bypasses it.
 *
 * Both separators are refused although only one of them is one here. This check
 * stands in front of a request body rather than in front of a path the app built
 * itself, and a name that would be a single component on every platform is the
 * only kind this will accept — a folder really called `back\slash` is a thing
 * nobody has, and a reader who found one is sent to the walk, which will list it.
 *
 * `.` and `..` are names the filesystem gives to two folders rather than names
 * anyone chose, and both of them mean "wherever this search already is" — which
 * is a path, asked for in the spelling of a name.
 */
function refusesAsName(name: string): boolean {
  if (name === "" || name.length > MAX_NAME_CHARS) return true;
  if (name === "." || name === "..") return true;
  return name.includes("/") || name.includes("\\") || name.includes("\0");
}

/**
 * By name, folders before the rest.
 *
 * For the same reason every other walk here sorts: `readdir` answers in whatever
 * order the filesystem happens to hold, so an unsorted search offers a reader a
 * different list on a different machine, and a different one on the same machine
 * after a rebuild.
 */
function byName(a: { name: string }, b: { name: string }): number {
  return a.name.localeCompare(b.name);
}
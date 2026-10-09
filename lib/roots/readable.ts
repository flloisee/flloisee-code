import path from "node:path";

import { admitUnder, type Refusal } from "./containment";
import type { ReadingRoot } from "./reading-root";

/**
 * The one answer to "may the Model read this", given the Reading Root.
 *
 * `admitUnder` is the comparison and knows nothing about Roots or Grants; this
 * is the part that does, and it is the part that decides whether the Model may
 * read a file — for the three Tools, the `@` menu, the pasted-path check and the
 * recheck at send, all of which ask it this way. Nothing else in the app reaches
 * the disk on the Model's behalf, because a second way of answering this
 * question is a second set of answers to keep in step with the first.
 *
 * Two decisions are made here, and they are the whole of the rule.
 *
 * The first is that a relative path is resolved **against the Root**, and by
 * this function rather than by `admitUnder`, which refuses one outright. The
 * reason is that resolving it anywhere else resolves it against the server's
 * working directory: inside the Root when the server was started in it, outside
 * on every other machine, which is one call meaning two different things. A
 * Model writing `src/index.ts` means a file in the folder the reader chose.
 *
 * The second is that the boundaries are one list, `[root, ...grants]`, and not
 * a Root checked and then each Grant checked in turn. A Grant is an addition to
 * the boundary and never a substitute for it, and asking the question twice
 * rather than as a list is how that comes apart: the Root's own check has to be
 * right on its own, so a caller who checks the Grants and forgets the Root reads
 * **nothing** while believing it reads the folder the reader chose — a silent
 * refusal, which is the one failure a reader cannot diagnose. "Under the Root
 * **or** under a Grant, and by nothing else" is not expressible as
 * `admitUnder(root, …) or admitUnder(grant, …)`; a list makes it so.
 */

/** Which boundary let a path through. */
export type Boundary = "root" | "grant";

export type Readable =
  | { readable: true; path: string; under: Boundary }
  | { readable: false; reason: Refusal };

const OUTSIDE: Readable = { readable: false, reason: "outside" };

/**
 * Resolves a path the Model named against the Root.
 *
 * An absolute path is left exactly as it was sent. That is the whole reason for
 * making it absolute: a path outside the Root arrives absolute and has to be
 * refused as such, rather than folded back inside so that it reads as something
 * the reader chose.
 *
 * A relative path is joined rather than resolved, because `..` is left in the
 * string for `admitUnder` to hand to the disk. `path.join` would collapse
 * `link/../src` on the way past, and the disk does not read it that way: it
 * follows `link` first, and applies the `..` where the link landed. Collapsing
 * it here would answer a different question from the one the disk answers, and
 * would substitute a file inside the Root for one outside it.
 *
 * Concatenation rather than a template so that the text of this line is one
 * thing a mutation can be aimed at; `scripts/mutation-check.sh` has two entries
 * that replace exactly this.
 */
export function resolveAgainstRoot(root: string, asked: string): string {
  if (path.isAbsolute(asked)) return asked;
  return root + path.sep + asked;
}

/**
 * Whether the Model may read `asked`, and where it really is.
 *
 * The path handed back on a yes is the resolved one, never the string that was
 * asked about. That is not cosmetic: a path reached through a link may stop
 * pointing where it did between the check and the read, so a caller that opens
 * what it was given can be moved in the gap. A caller that opens what it was
 * handed cannot, because there is no link left in it.
 */
export async function mayRead(reading: ReadingRoot, asked: string): Promise<Readable> {
  const root = reading.root;
  // A Grant is an addition to the Root, and without a Root there is nothing for
  // it to be an addition to: no Root means no boundaries at all, rather than the
  // Grants alone. That is what v1 behaviour depends on — no Root means no
  // Tools, no files and nothing asked — and `outside` is the honest reason for
  // it, because with no boundary there was nothing the path could have been
  // inside.
  if (root === null) return OUTSIDE;

  const answer = await admitUnder([root, ...reading.grants], resolveAgainstRoot(root, asked));

  if (!answer.admitted) return { readable: false, reason: answer.reason };

  // `boundary` comes back as the caller wrote it, which for the Root is `root`
  // itself, and the Root is first in the list — so a path the Root covers is
  // never reported as a Grant's, even where a Grant sits inside it.
  return {
    readable: true,
    path: answer.path,
    under: answer.boundary === root ? "root" : "grant",
  };
}
import { promises as fs } from "node:fs";
import path from "node:path";

import { z } from "zod";

import { mayRead } from "@/lib/roots/readable";
import { readReadingRoot } from "@/lib/roots/reading-root";
import { walkFiles } from "@/lib/roots/scan";

/**
 * Naming a file from the Root, and having a verdict on a path the reader typed.
 *
 * Two actions, both read-only, and both deliberately kept out of the chat route:
 * a composer asking "what is in here" on every keystroke is a different kind of
 * work from generating a Response, and folding the two together would make a
 * walk look like a failure to generate.
 *
 * **This route writes nothing, and so it works in any build.** That is the whole
 * reason it is not the Root route, and the difference is worth being exact about
 * rather than saying "reading is safe, writing is not": the Root route records a
 * folder on the developer's machine, so it is bounded by refusing to run outside
 * development, while this one is bounded by the Root itself — a build that cannot
 * declare a Root cannot widen one, and every path it is about was resolved
 * through `mayRead` before anything was read. A capability that never writes
 * cannot be aimed anywhere by being told to write.
 *
 * **The browser never names a path here, and never sees one.** `find` takes the
 * words after an `@` and answers with paths *from the Root*, so what reaches the
 * interface is short to read and the reader's home directory is never spelled out
 * in their own Conversation. `resolve` is the exception and deliberately so:
 * ticket 09 has to have a path sent back that the Tools will then be asked for,
 * so it answers with the same Root-relative form and the containment check stays
 * the only thing deciding what may be read.
 *
 * **The search is the Root's own walk, bounded exactly as `search_files` bounds
 * its own.** `node_modules`, `.git` and `.env*` are never named, `.gitignore` is
 * honoured, and the folder ceiling is the same one. What differs is that the walk
 * is asked for names rather than for text, so no file is opened: a menu that
 * filtered by name by reading every file in the Root first would be paying a
 * megabyte a file to answer a question about characters — and it would be unable
 * to offer the reader an image, which is a file they very much want to name.
 *
 * POST and nothing else, for the reason the Models route gives: under Cache
 * Components a GET Route Handler follows the prerender model of a page, so an
 * answer that varies by Root would be frozen at build time and served to whoever
 * asked first.
 */

/** How many entries one `find` will offer, whatever the Root holds. */
export const MAX_FIND_MATCHES = 200;

/** How much of a path the query may be, which `path.isAbsolute` and the disk both bound anyway. */
const MAX_QUERY_CHARS = 400;

const findRequestSchema = z
  .object({
    action: z.literal("find"),
    query: z
      .string()
      .max(MAX_QUERY_CHARS)
      .describe("The words after the `@`, matched against each path from the Root."),
  })
  .strict();

const resolveRequestSchema = z
  .object({
    action: z.literal("resolve"),
    path: z.string().min(1).describe("The path the reader named, as they wrote it."),
  })
  .strict();

const filesRequestSchema = z.discriminatedUnion("action", [findRequestSchema, resolveRequestSchema]);

const MALFORMED_REQUEST =
  "Asking about a file takes one of \"find\" or \"resolve\" — as " +
  '{ "action": "find", "query": ... } and so on.';

/** What each refusal says. None of them quotes a path back, and none is the reader's fault. */
const REFUSED = {
  outside:
    "That path is outside the folder you chose for the Model to read, so it was not looked at. " +
    "Pick something from inside the folder, or add a Grant for it in Settings.",
  unreadable:
    "There is nothing at that path. It may have been moved or deleted since you named it.",
  unusable: "That is not a path that can be read — a path cannot carry a null byte.",
  gone:
    "The folder you chose is no longer there, so there is nothing to look through. Choose it again in Settings.",
} as const;

function refused(reason: keyof typeof REFUSED): Response {
  return Response.json({ error: REFUSED[reason] }, { status: 400 });
}

export async function POST(request: Request) {
  const parsed = filesRequestSchema.safeParse(await request.json().catch(() => null));

  if (!parsed.success) {
    return Response.json({ error: MALFORMED_REQUEST }, { status: 400 });
  }

  const reading = await readReadingRoot(process.cwd());

  if (parsed.data.action === "resolve") {
    const allowed = await mayRead(reading, parsed.data.path);
    if (!allowed.readable) return refused(allowed.reason);

    const stats = await fs.stat(allowed.path).catch(() => null);
    if (stats === null) return refused("unreadable");

    // Named from the Root where the Root is what answered, and in full where a
    // Grant was. There is no shorter honest form of a path outside the Root —
    // `path.relative` would hand back a way out of the folder the reader chose,
    // which is both a confusing thing to read and one the Tools would have to
    // resolve to be sure of. So a Grant's answer is the absolute path, and the
    // asymmetry is deliberate rather than an oversight.
    const named =
      allowed.under === "root" && reading.root !== null
        ? path.relative(reading.root, allowed.path)
        : allowed.path;

    return Response.json({
      path: named,
      under: allowed.under,
      kind: stats.isDirectory() ? "directory" : "file",
      size: stats.isFile() ? stats.size : null,
    });
  }

  const { query } = parsed.data;

  // No Root is an answer rather than a failure: the composer says so in as many
  // words instead of opening a list of nothing. The note is the sentence it says,
  // so a machine holding a file this app cannot read is not reported as "no Root
  // chosen" — the reader has declared one and it is not being read.
  if (reading.root === null) {
    return Response.json({
      rootDeclared: false,
      matches: [],
      complete: true,
      note: reading.malformed
        ? "The file recording the folder cannot be read, so there is nothing to pick from. Remove it and choose the folder again."
        : "You have not chosen a folder for the Model to read yet, so there is nothing to pick from. Choose one in Settings.",
    });
  }

  // The one gate, asked the way everything else in the app asks it. The Root is
  // the whole boundary for a menu — a Grant names a path to read, and this
  // answers about the folder the reader chose rather than about what lies beyond
  // it — so the Root is what the walk is given.
  const allowed = await mayRead(reading, ".");
  if (!allowed.readable) return refused("gone");

  const matches: { name: string; path: string; kind: "file" | "directory" }[] = [];
  const wanted = matcher(query);
  let capped = false;

  const walk = await walkFiles({
    from: allowed.path,
    onEntry: (entry) => {
      if (!wanted(entry.relative)) return true;
      // Returning `false` here stops the walk rather than truncating a list that
      // was already full, so a Root of half a million files stops at the ceiling
      // rather than after reading every name in it.
      if (matches.length >= MAX_FIND_MATCHES) {
        capped = true;
        return false;
      }
      matches.push({ name: entry.name, path: entry.relative, kind: entry.kind });
      return true;
    },
  });

  return Response.json({
    rootDeclared: true,
    matches,
    complete: !walk.stopped,
    note: note(query, matches.length, walk.stopped, capped),
  });
}

/**
 * Whether a path from the Root is one the reader typed toward.
 *
 * Substring, case-insensitive, over the whole Root-relative path rather than over
 * the file's name: a reader who types `src/uti` is looking for something under
 * `src`, and a matcher that only knew names would answer "nothing matches" for
 * the half of what they wrote that they very much typed on purpose.
 */
function matcher(query: string): (relative: string) => boolean {
  const wanted = query.trim().toLowerCase();
  if (wanted === "") return () => true;
  return (relative) => relative.toLowerCase().includes(wanted);
}

/**
 * A sentence about the answer, which the composer shows whenever there is no list
 * to show instead of it — and whenever there is one but it does not hold
 * everything.
 *
 * Every ceiling in this feature states itself rather than being applied
 * silently, and this is the menu's: a list cut short that reads as complete is a
 * list that tells a reader a file does not exist.
 */
function note(query: string, found: number, stopped: boolean, capped: boolean): string {
  if (found === 0) {
    return `Nothing in the folder matches "${query.trim()}".`;
  }

  if (capped) {
    return `Showing the first ${MAX_FIND_MATCHES} of more that match. Keep typing to narrow them down.`;
  }

  if (stopped) {
    return `Showing ${found}, and the walk through the folder stopped before the end.`;
  }

  return found === 1 ? "1 file or folder." : `${found} files and folders.`;
}
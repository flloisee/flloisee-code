import { namedPaths } from "@/lib/roots/named-path";
import { takeDecisions } from "@/lib/roots/named-decision";
import { mayRead } from "@/lib/roots/readable";
import type { ReadingRoot } from "@/lib/roots/reading-root";
import { listNamedFolder, readNamedFile } from "@/lib/tools/file-tools";

/**
 * Placing the files a reader named into the message they were named in.
 *
 * The composer already asked about each of them, and this is the second half: the
 * same question asked again at send, on the server, against the Root as it is
 * *now*. Both halves run the same recogniser over the same words, so the paths
 * checked here are the paths the reader was shown — but the answer is not theirs.
 * A file can be deleted, or the Root moved, in the seconds between the two, and
 * the whole reason this exists is that a message which quietly loses a file reads
 * to the Model as a complete answer about the wrong set of files.
 *
 * **The check is containment and it is the server's.** `mayRead` is asked here
 * exactly as the three Tools ask it, with the reader's own answer admitted as the
 * third boundary — the parameter ticket 04 put there for this. Nothing about which
 * paths are looked at comes from the request: the request carries a message, this
 * finds the paths in it, and every one of them is put through the same admission
 * before anything is opened. A caller cannot name a path to be read by sending one
 * in a field, because there is no such field, and cannot widen the boundary by
 * saying so, because the boundary is a file on the server.
 *
 * **A named file is inlined as text, in a block that says which file it came from.**
 * The SDK can send a file part and several Endpoints would take one; most of them
 * would not, and one code path across all of them is the property this app is
 * built on. Inlining is dull and works everywhere.
 *
 * **A refusal is text too, not an omission.** Binary, a file past the cap, a
 * folder that could not be opened: each becomes a block naming the file and saying
 * what happened, so the Model can tell the reader why it cannot see something they
 * attached. The one refusal that is *not* text is a path that is not admitted —
 * that one stops the Turn, because it is not a fact about the file.
 */

/**
 * What one message carries out, or why it is not going anywhere.
 *
 * A refusal names the file. Not quoting it back would leave the reader with an
 * error about a message rather than about the one path in it that stopped
 * everything, and they would have to work out which that was.
 */
export type Attachment =
  | {
      ok: true;
      /** The message with a block appended for every file it named. */
      text: string;
      /** The paths that were named, whether or not each one could be sent. */
      named: string[];
    }
  | { ok: false; error: string };

/**
 * The block a file's contents go in.
 *
 * Open and close, both naming the file, because the Model has no parser to fall
 * back on: the line that says where the file ends is the only thing marking it, and
 * a file whose contents happened to look like a delimiter would otherwise run into
 * the next file's. A fence the reader could also read is a second reason — this
 * block is in their Conversation and in every later Turn of it.
 */
const OPEN = (name: string): string => `[file: ${name}]`;
const CLOSE = (name: string): string => `[end of file: ${name}]`;

/**
 * Why a named path is not being sent, in a sentence that names it.
 *
 * Three reasons and no others, because these are the three ways a message can
 * name something the app will not read: the boundary moved, the path is gone, or
 * the path was never one. Each says what to do about it, which is the half of a
 * refusal the reader can act on — and none of them is "something went wrong",
 * which is the half they cannot.
 */
function refused(path: string, reason: string): string {
  if (reason === "outside") {
    return `${path} is outside the folder you chose for the Model to read, so this message was not sent. Add a Grant for it in Settings, or allow it when you name it.`;
  }
  if (reason === "unreadable") {
    return `${path} is not there any more, so this message was not sent. It may have been moved or deleted since you named it.`;
  }
  return `${path} is not a path that can be read, so this message was not sent. Paths are written out in full, or as they appear from the folder you chose.`;
}

/**
 * The message with every file it named beside it, or a refusal naming one.
 *
 * Nothing is read before the check, and nothing outside a boundary is read at all:
 * `mayRead` decides that for every path, and only a path it admitted is handed to
 * the same read the Tools use. **A path the reader refused is reported rather than
 * skipped** — the message still goes, the Model still gets everything else it
 * named, and it is told in the same block format that this one was left out.
 */
export async function attachNamedFiles(reading: ReadingRoot, text: string): Promise<Attachment> {
  const paths = namedPaths(text);

  // The answers are spent by this send whatever it turns out to find, because they
  // were given about this message and there is no later message they were about.
  const decisions = takeDecisions();

  // With no Root there are no boundaries, so there is nothing a named path could
  // cross and nothing this app is able to read. That is the state the app was in
  // before the reader chose a folder, and a Turn is a Turn in that state.
  if (paths.length === 0 || reading.root === null) {
    return { ok: true, text, named: paths };
  }

  const blocks: string[] = [];

  for (const path of paths) {
    const decision = decisions.get(path);

    if (decision === "denied") {
      blocks.push(block(path, "You did not allow this file to be read, so it was left out of this message."));
      continue;
    }

    // The reader saying yes to *this* path, and not to a path prefix, is the third
    // boundary `mayRead` admits. It comes from the server's own record rather than
    // from the request, which is the whole of what makes it evidence.
    const allowed = await mayRead(reading, path, decision === "allowed");
    if (!allowed.readable) return { ok: false, error: refused(path, allowed.reason) };

    const read = await readNamedFile(reading, path, { answered: decision === "allowed" });

    if (read.ok) {
      // The note first, because it is what tells the Model this is a piece of a
      // larger file and where the rest of it is — and a note under two thousand
      // lines of output is a note nobody reads.
      blocks.push(block(read.path, read.note, ...read.lines));
      continue;
    }

    // A folder is named by the reader who wants to know what is in it, and a
    // folder's contents are every file under it. So a folder sends its listing —
    // which is the same answer `list_files` would give, under the same cap.
    if (read.reason === "not-a-file") {
      const listed = await listNamedFolder(reading, path, { answered: decision === "allowed" });
      if (listed.ok) {
        blocks.push(block(listed.path, listed.note, ...entriesOf(listed)));
        continue;
      }
      if (listed.reason === "outside") return { ok: false, error: refused(path, listed.reason) };
      blocks.push(block(path, listed.note));
      continue;
    }

    // Everything else — binary, past the cap — is a fact about the file and goes in
    // the message. A Model told why it cannot see a file the reader attached can
    // say so; one handed an empty block cannot.
    blocks.push(block(path, read.note));
  }

  return { ok: true, text: `${text}\n\n${blocks.join("\n\n")}`, named: paths };
}

/** One file's block: the name, what is in it, and the name again. */
function block(name: string, ...parts: string[]): string {
  return `${OPEN(name)}\n${parts.join("\n")}\n${CLOSE(name)}`;
}

/**
 * A folder's listing, one line per entry.
 *
 * The names `list_files` gives, under the cap it gives them under, and with a
 * trailing `/` on a folder — the shape a reader would type to get back to it. An
 * empty folder has no lines at all and says so in the note instead.
 */
function entriesOf(listed: { entries: { kind: string; path: string }[] }): string[] {
  return listed.entries.map((entry) => (entry.kind === "directory" ? `${entry.path}/` : entry.path));
}
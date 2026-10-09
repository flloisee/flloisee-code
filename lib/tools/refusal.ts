import { promises as fs } from "node:fs";
import path from "node:path";

import type { Refusal as PathRefusal } from "@/lib/roots/containment";
import type { Boundary } from "@/lib/roots/readable";
import type { ReadingRoot } from "@/lib/roots/reading-root";

/**
 * What a Tool says when it will not do what it was asked.
 *
 * A refusal is a **result**, never a thrown error. The SDK turns a thrown error
 * into a `tool-error` part and carries on, so the Turn would survive either way —
 * but a `tool-error` reads as a failure of the machinery, and a Model handed one
 * tends to treat the whole call as broken rather than as an answer about a path.
 * Every refusal here is ordinary data in the ordinary result shape, with
 * `ok: false` and a reason, because the reader's question — *why not?* — is one
 * the Model can answer and act on.
 *
 * The reasons are containment's own plus the ones only a reader of bytes can
 * produce. They are kept apart on purpose: `outside` is a decision this app made
 * about where it may look, `unreadable` is a typo, and `not-text` is a fact
 * about the file. A Model that retries `unreadable` with a corrected spelling
 * gets an answer; one that keeps retrying `outside` is reaching for something the
 * reader did not hand over.
 */
export type Reason =
  /** Carried from containment: not under the Root, and not under a Grant. */
  Extract<PathRefusal, string>
  /** The path is there, and is a file where a folder was asked for. */
  | "not-a-directory"
  /** The path is there, and is a folder where a file was asked for. */
  | "not-a-file"
  /** The bytes are not text, and showing them would put mangled content in the transcript. */
  | "not-text"
  /** The file is larger than any single read is allowed to be. */
  | "too-large"
  /** The arguments are not ones this Tool accepts. */
  | "not-asked-well";

/**
 * A refusal: a reason the interface can render, and a sentence the Model can act
 * on.
 *
 * The sentence is not decoration. On a small local Model the Tools' descriptions
 * are often the only prose it ever sees, and a `reason` of `"outside"` on its own
 * says nothing about what to do next. Both halves are returned because each
 * answers a different question — `reason` is what the transcript shows, `note` is
 * what the Model reads.
 */
export type Refusal = {
  ok: false;
  reason: Reason;
  /** A full sentence, naming the path and what would make the call work. */
  note: string;
};

export function refuse(reason: Reason, note: string): Refusal {
  return { ok: false, reason, note };
}

/**
 * How a path is written back to the Model.
 *
 * See {@link namer}, which this is the one-shot form of.
 */
export async function nameable(
  reading: ReadingRoot,
  resolved: string,
  under: Boundary,
): Promise<string> {
  return (await namer(reading, under))(resolved);
}

/**
 * How paths are written back to the Model, once decided.
 *
 * What the Model named is not what should come back: an absolute path into a
 * reader's home directory is long, and it is their own machine spelled out inside
 * their own Conversation. A path inside the Root is therefore returned the way the
 * Model would have written it — relative to the Root — and only a path that came
 * in under a Grant is returned absolute, because there is no shorter form of it
 * that would still name the same file. Both round-trip: `mayRead` resolves a
 * relative path against the Root, so a path handed back can be handed straight
 * back again.
 *
 * The Root is resolved before anything is compared against it rather than used as
 * it was written, because on macOS those are different strings for every path
 * under `/var` or `/tmp`, and subtracting one from the other yields a path full of
 * `..` that no longer names the file. Anything that does not come out as a
 * relative path — a Root that will not resolve, a path the resolved Root does not
 * really contain — comes back absolute, which is always true.
 *
 * The resolved Root is worked out once and the rest is arithmetic, because a
 * search that names two hundred matches would otherwise resolve the Root two
 * hundred times to subtract it two hundred times.
 */
export async function namer(
  reading: ReadingRoot,
  under: Boundary,
): Promise<(resolved: string) => string> {
  if (under !== "root" || reading.root === null) return (resolved) => resolved;

  const realRoot = await resolveQuietly(reading.root);
  if (realRoot === null) return (resolved) => resolved;

  return (resolved: string): string => {
    if (resolved !== realRoot && !resolved.startsWith(realRoot + path.sep)) return resolved;

    const relative = path.relative(realRoot, resolved);
    return relative === "" ? "." : relative;
  };
}

async function resolveQuietly(target: string): Promise<string | null> {
  try {
    return await fs.realpath(target);
  } catch {
    return null;
  }
}

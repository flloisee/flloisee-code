import { z } from "zod";

import { readRouteError, readRouteJSON } from "@/lib/http/route-answer";

/**
 * Asking what is in the Root, and having a verdict on a path the reader typed.
 *
 * Two requests and four answers, kept distinct rather than collapsed into "some
 * files" or "no". The distinction that matters most is the first one: a folder
 * that was never chosen and a folder with nothing matching in it look identical
 * on the wire as an empty list, and they are opposite things for the reader — one
 * is something they can go and fix, the other is an answer.
 *
 * The route's wording is passed up rather than replaced, for the reason the Root
 * picker passes it up: a refusal here is the server telling the reader what it
 * will not do and what to do instead, and rewriting it in this file would mean
 * two places keeping one set of sentences in step with each other.
 *
 * There is no path through this module that can put a file's contents anywhere.
 * Both answers carry names and addresses and nothing else — what is in a file is
 * a question for the Tools, asked over a channel the reader sees.
 */

const offeredSchema = z.object({
  name: z.string(),
  path: z.string(),
  kind: z.enum(["file", "directory"]),
});

const foundSchema = z
  .object({
    rootDeclared: z.boolean(),
    matches: z.array(offeredSchema),
    complete: z.boolean(),
    note: z.string(),
  })
  .strict();

const resolvedSchema = z
  .object({
    path: z.string(),
    under: z.enum(["root", "grant"]),
    kind: z.enum(["file", "directory"]),
    size: z.number().nullable(),
  })
  .strict();

/** One entry the menu may offer, named from the Root. */
export type Offered = z.infer<typeof offeredSchema>;

export type FileAnswer =
  /** The Root was read, and here is what was in it — possibly nothing at all. */
  | { status: "found"; matches: Offered[]; complete: boolean; note: string }
  /** There is no Root, so there is nothing to look through. */
  | { status: "no-root"; note: string }
  | { status: "refused"; message: string };

export type ResolvedFile =
  | {
      status: "resolved";
      /** From the Root where the Root answered, and in full where a Grant did. */
      path: string;
      under: "root" | "grant";
      kind: "file" | "directory";
      size: number | null;
    }
  | { status: "refused"; message: string; reason: Verdict };

/**
 * What kind of refusal this is, and the one kind that puts a question to the
 * reader rather than a sentence on screen.
 *
 * `outside` is the only one. A path the Root does not cover and no Grant does is
 * the reader's own decision to make — they named the file, the Model did not ask —
 * and every other refusal is a sentence they can act on by fixing a word: the
 * path is not there, it is not a path, no folder has been chosen, or the folder
 * itself has gone.
 *
 * `unknown` rather than a default of `outside`: a body this file cannot read is a
 * route that has answered in a form it does not know, and reading that as
 * "outside" would put a question to the reader about a boundary it cannot
 * describe. The narrow answer is the safe one, and it is also the honest one.
 */
export type Verdict = "outside" | "unreadable" | "unusable" | "no-root" | "gone" | "unknown";

/** The reasons the route names, so an unrecognised one is `unknown` rather than a guess. */
const verdictSchema = z
  .enum(["outside", "unreadable", "unusable", "no-root", "gone", "unknown"])
  .catch("unknown");

const UNREACHABLE = "Could not reach the app's file route.";
const UNREADABLE_ANSWER = "The app's file route answered in an unexpected form.";

async function post(body: unknown): Promise<{ status: number; body: unknown }> {
  try {
    const response = await fetch("/api/files", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await readRouteJSON(response) };
  } catch {
    // 0 means the route was never reached, which a caller has to be able to tell
    // apart from a route that ran and refused.
    return { status: 0, body: null };
  }
}

function refusalFrom(status: number, body: unknown): { status: "refused"; message: string } {
  if (status === 0) return { status: "refused", message: UNREACHABLE };
  return {
    status: "refused",
    message: readRouteError(body) ?? "The app refused that. Nothing was read.",
  };
}

/**
 * A refusal on a path, and what kind it was, read apart from its sentence.
 *
 * The route puts `reason` beside `error` for exactly this: the composer has to put
 * a question to the reader for one of these and only show a note for the rest, and
 * the two are otherwise the same shape of thing — one sentence about something
 * that was not done. Parsed rather than taken as given, so a body without one is
 * `unknown`, which is nothing to act on, rather than `outside`, which would be a
 * question to the reader about a boundary nobody described.
 */
function verdictFrom(
  status: number,
  body: unknown,
): { status: "refused"; message: string; reason: Verdict } {
  const said = refusalFrom(status, body).message;
  const reason = (body as { reason?: unknown } | null)?.reason;

  return {
    status: "refused",
    message: said,
    reason: verdictSchema.parse(reason),
  };
}

/** The menu's answer: what is in the Root, filtered by what was typed after the `@`. */
export async function findFiles(query: string): Promise<FileAnswer> {
  const { status, body } = await post({ action: "find", query });

  if (status !== 200) return refusalFrom(status, body);

  const parsed = foundSchema.safeParse(body);

  // A shape this file does not recognise is a refusal of its own, never an empty
  // Root: "nothing here matches" and "the app answered in a form I cannot read"
  // would otherwise be the same sentence to a reader whose folder is full.
  if (!parsed.success) return { status: "refused", message: UNREADABLE_ANSWER };

  const { rootDeclared, matches, complete, note } = parsed.data;
  if (!rootDeclared) return { status: "no-root", note };

  return { status: "found", matches, complete, note };
}

/** What a path the reader typed is: inside the Root, under a Grant, or neither. */
export async function resolvePath(asked: string): Promise<ResolvedFile> {
  const { status, body } = await post({ action: "resolve", path: asked });

  if (status !== 200) return verdictFrom(status, body);

  const parsed = resolvedSchema.safeParse(body);
  // A 200 in a shape this file does not recognise is a refusal of its own, and
  // never a verdict: `unknown` is the answer, because nothing here can say whether
  // the path is inside the boundary or beyond it, and guessing "outside" would put
  // a question to the reader about a file nobody has checked.
  if (!parsed.success) return { status: "refused", message: UNREADABLE_ANSWER, reason: "unknown" };

  return { status: "resolved", ...parsed.data };
}
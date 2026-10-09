import { promises as fs } from "node:fs";

import { z } from "zod";

import { admitUnder } from "@/lib/roots/containment";
import { decide } from "@/lib/roots/named-decision";
import { locateFolder, type LocateRefusal } from "@/lib/roots/locate";
import { resolveAgainstRoot } from "@/lib/roots/readable";
import {
  declareRoot,
  forgetRoot,
  grantPath,
  readReadingRoot,
  revokeGrant,
} from "@/lib/roots/reading-root";
import { listDirectory, walkBoundary, type WalkRefusal } from "@/lib/roots/walk";

/**
 * Declaring a Root: the reader says which folder the Model may read, and that
 * answer survives a restart — and answering, once or always, when they name a file
 * that is not in it.
 *
 * Four capabilities in one route, and each is bounded rather than trusted. The
 * route lists folders, so a caller who could name any path would turn it into a
 * map of the developer's machine; it writes a file recording a folder, which is a
 * capability a deployed build must not have at all — the same reasoning as Key
 * Entry, and refused the same way; and it holds the reader's own answer about a
 * path they named until the next message is sent, which is the third reason a
 * caller must not be able to do it for them.
 *
 * The browser does name a path, and that is deliberate rather than a compromise.
 * What it may only name is a path this route has just offered: every path below
 * goes through the same admission the rest of the feature is stood on, so a
 * caller can walk the reader's home folder and no further. The alternative —
 * the browser saying "the third entry of the second folder" and the server
 * keeping the map — is a second source of truth to invalidate, and it buys
 * nothing while the walk is bounded.
 *
 * **`locate` is the other half of that, and it is the way in.** No browser folder
 * picker can return an absolute path: Chrome removed `File.path` in v61 and
 * nothing has put it back. So the reader's own operating-system dialog gives the
 * browser a *name*, and this action is what turns that name into somewhere — a
 * search of the same bounded home folder, whose every candidate goes through the
 * same admission. It answers with the paths rather than choosing between them,
 * because the choice is the reader's: a `Projects` on a volume this app cannot
 * reach and a `Projects` in their home folder are the same string, and only the
 * reader knows which they picked. See `lib/roots/locate`.
 *
 * POST and nothing else, for the reason the Key Entry route gives: under Cache
 * Components a GET Route Handler follows the prerender model of a page, and a
 * prerendered listing here would answer from a moment the developer never asked
 * about.
 */

const rootsRequestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("read") }).strict(),
  z.object({ action: z.literal("find"), path: z.string().min(1).optional() }).strict(),
  // A name, never a path. What the route does with it — and refuses — is
  // `locateFolder`'s, so the shape here only insists there is one.
  z.object({ action: z.literal("locate"), name: z.string().min(1) }).strict(),
  z.object({ action: z.literal("declare"), path: z.string().min(1) }).strict(),
  z.object({ action: z.literal("forget") }).strict(),
  // The two a Grant needs. The path is what the Model asked for and nothing
  // else — not a Root, not a boundary — because every one of those is the
  // server's to hold. `grant` resolves it against the Root the same way the
  // approval policy does, so the browser never gets to say where a Grant lands.
  z.object({ action: z.literal("grant"), path: z.string().min(1) }).strict(),
  z.object({ action: z.literal("revoke"), path: z.string().min(1) }).strict(),
  // The two a reader's own answer needs, given in the composer before the Turn
  // exists. The path is the words the reader wrote, and it is kept exactly: the
  // answer is held against that spelling, because that is the spelling they were
  // shown when they gave it.
  z.object({ action: z.literal("allow"), path: z.string().min(1) }).strict(),
  z.object({ action: z.literal("deny"), path: z.string().min(1) }).strict(),
]);

const MALFORMED_REQUEST =
  'Naming a Root takes one of "read", "find", "locate", "declare", "forget", "grant", "revoke", ' +
  '"allow", or "deny" — as { "action": "find", "path": ... } and so on.';

/**
 * What each refusal says.
 *
 * Every message names the cause and gives the reader something to do, and none
 * of them quotes a path back. A path in a refusal is one the caller chose, so
 * echoing it would disclose nothing — but the useful half of a refusal is what
 * to try instead, and a message that leads with the offending string reads as an
 * error report rather than as an answer.
 *
 * The one refusal here that is not about a path is about the *shape* of a string
 * that was going to be a path, which is the same question as `unusable` below and
 * so belongs beside it rather than in a map of its own.
 */
const REFUSED: Record<WalkRefusal | LocateRefusal, string> = {
  outside:
    "The walk only goes through your home folder, and that is not inside it. " +
    "Choose a folder inside your home folder, and the Model will read that.",
  unreadable:
    "There is nothing at that path. It may have been moved or deleted since it " +
    "was listed — walk back up and choose it again.",
  unusable:
    "That path cannot be read: a path cannot carry a null byte. Choose a folder " +
    "from the listing instead of typing one.",
  "not-a-directory":
    "A Root has to be a folder that is there now, and that one is not a folder. " +
    "Choose a folder from the listing rather than a file inside one.",
  "not-a-name":
    "A folder can only be looked for by its name, and that is not one — it may " +
    "carry a path separator or a null byte, or be too long to be a folder's " +
    "name at all. Choose the folder again, or walk to it from your home folder.",
};

/**
 * The two refusals that are about a Grant rather than about the walk or a name.
 *
 * Not refusals of either: these are answers to a question neither is ever asked,
 * and folding them in would have a map claiming to describe the shape of a
 * string as well as the boundary of a path — which is how a map stops being
 * worth reading.
 */
const GRANT_REFUSED: Record<Exclude<Refusal, WalkRefusal | LocateRefusal>, string> = {
  "no-root":
    "No folder has been chosen for the Model to read, so there is nothing to allow " +
    "anything outside of. Choose a folder first.",
  "already-decided":
    "That path is already inside the folder the Model reads, so it is read without " +
    "asking — there is nothing to remember about it and nothing to decide.",
};

/** Why this route will not do what it was asked: the walk's, a name's, or a Grant's. */
type Refusal = WalkRefusal | LocateRefusal | "no-root" | "already-decided";

function refused(reason: Refusal): Response {
  return Response.json(
    {
      error:
        reason in REFUSED
          ? REFUSED[reason as WalkRefusal | LocateRefusal]
          : GRANT_REFUSED[reason as Exclude<Refusal, WalkRefusal | LocateRefusal>],
    },
    { status: 400 },
  );
}

export async function POST(request: Request) {
  if (process.env.NODE_ENV !== "development") {
    return Response.json(
      {
        error:
          "Naming a Reading Root runs only in development. It records a folder on this " +
          "machine, and that capability is not part of a deployed build.",
      },
      { status: 404 },
    );
  }

  const parsed = rootsRequestSchema.safeParse(await request.json().catch(() => null));

  if (!parsed.success) {
    return Response.json({ error: MALFORMED_REQUEST }, { status: 400 });
  }

  const { action } = parsed.data;

  if (action === "read") {
    const reading = await readReadingRoot(process.cwd());
    return Response.json({
      root: reading.root,
      // The Grants travel with the Root because the reader has to be able to see
      // what they have already allowed, and a boundary they cannot see is a
      // boundary they cannot take back.
      grants: reading.grants,
      malformed: reading.malformed,
    });
  }

  if (action === "forget") {
    await forgetRoot({ dir: process.cwd() });
    return Response.json({ root: null, grants: [] });
  }

  if (action === "allow" || action === "deny") {
    const answered = await answerDecision(action, parsed.data.path);
    if (!answered.ok) return refused(answered.reason);
    return Response.json(answered.body);
  }

  if (action === "grant" || action === "revoke") {
    const answered = await answerGrant(action, parsed.data.path);
    if (!answered.ok) return refused(answered.reason);
    return Response.json(answered.body);
  }

  if (action === "find") {
    const target = parsed.data.path ?? walkBoundary();
    const listing = await listDirectory(target);

    if (!listing.ok) return refused(listing.reason);

    // Built rather than spread, so the shape on the wire is the three fields the
    // reader's browser is written against. `ok` is the walk's own marker for
    // which half of its answer this is, and it has no meaning to a caller that
    // only ever sees a refusal as a status and a message.
    return Response.json({
      path: listing.path,
      parent: listing.parent,
      entries: listing.entries,
    });
  }

  if (action === "locate") {
    const located = await locateFolder(parsed.data.name);

    if (!located.ok) return refused(located.reason);

    // Built rather than spread, for the reason `find`'s answer is built: these
    // are the two fields the reader's browser is written against, and the
    // search's own marker for which half of its answer this is means nothing to
    // a caller that never sees one. `complete` travels with the list because a
    // list of one is not the same claim as a list of one that is the only one.
    return Response.json({ matches: located.matches, complete: located.complete });
  }

  // Declaring. The path is admitted and checked to be a folder before anything
  // is written, so the file never holds a Root that could not be read from.
  const declared = parsed.data.path;
  const admitted = await admitUnder([walkBoundary()], declared);

  if (!admitted.admitted) return refused(admitted.reason);

  const isFolder = (await fs.stat(admitted.path).catch(() => null))?.isDirectory() ?? false;
  if (!isFolder) return refused("not-a-directory");

  await declareRoot({ dir: process.cwd(), root: admitted.path });

  // The resolved path rather than the one sent, because this is the string every
  // later check is made against and a reader deciding whether the right folder
  // was recorded needs to see where it really points.
  return Response.json({ root: admitted.path });
}

/** What the two Grant actions can answer: the file as it now stands, or a refusal. */
type GrantAnswer =
  | { ok: true; body: { root: string; grants: string[] } }
  | { ok: false; reason: Refusal };

/**
 * Recording and taking back a path the reader has allowed beyond the Root.
 *
 * **The browser sends what the Model wrote and the server works out where it is.**
 * The caller of `grant` is the interface, acting on an approval request, and it
 * holds the relative path in the Tool Call's input — a path it cannot resolve,
 * because it does not know the Root. Resolving it here with the same rule the
 * approval policy uses means one answer to "where does this path point" rather
 * than two that could disagree, which is what would make a Grant cover a
 * different file from the one the reader was shown.
 *
 * **Bounded by the walk, like a Root.** A Grant is an addition to the boundary
 * and not a way around it, and the edge that keeps a deployed build from holding
 * the reader's home folder as a set of open doors is the same edge a Root is held
 * to. Without it this route would be a general "make this readable" request
 * aimed at a server that holds every Credential on the machine.
 *
 * **A path inside the Root is refused rather than recorded.** Nothing was ever
 * asked about such a path, so a Grant for it is an entry in the list that no
 * decision of the reader's backs — and a list of those would make the real
 * Grants harder to see, which is the one thing the list is for.
 *
 * `revoke` compares exactly and never resolves, so it can only ever take one
 * entry out of a list of paths this route wrote. That is the whole of what it can
 * do, which is why it takes no boundary check and refuses nothing.
 */
async function answerGrant(action: "grant" | "revoke", asked: string): Promise<GrantAnswer> {
  const dir = process.cwd();
  const reading = await readReadingRoot(dir);

  if (reading.root === null) return { ok: false, reason: "no-root" };

  if (action === "revoke") {
    // The caller names a path the route itself listed, so it is already resolved
    // and there is nothing to resolve it against.
    await revokeGrant({ dir, path: asked });
    const after = await readReadingRoot(dir);
    return { ok: true, body: { root: reading.root, grants: after.grants } };
  }

  const admitted = await beyondRoot(reading, asked);
  if (!admitted.ok) return { ok: false, reason: admitted.reason };

  await grantPath({ dir, path: admitted.path });
  const after = await readReadingRoot(dir);
  return { ok: true, body: { root: reading.root, grants: after.grants } };
}

/**
 * The reader's own answer about one path they named, held for the next send.
 *
 * **Nothing is written, and that is what these two answers are for.** A Grant
 * lasts until the reader removes it, because a reader who pressed "always allow"
 * has said something standing. "Allow once" and "Deny" have said something about
 * one message, so they are held in this process and spent by the send they were
 * given for — see `lib/roots/named-decision`.
 *
 * **They are here, on the route that writes, because the browser must not be able
 * to mint one.** The check at send happens on the server, and a decision that
 * arrived in the request would be a caller naming the path to be read: the exact
 * primitive the chat route refuses by taking no path from a request at all. So
 * the only way one exists is through this route, behind its development guard.
 * That is also why "allow once" is refused in a deployed build, in the same words
 * and for the same reason as "always allow" — one place decides whether a reader
 * can widen the boundary at all.
 *
 * **The path is kept exactly as the reader wrote it.** Everything above resolves
 * it and checks it; nothing here rewrites it. The recogniser is the same function
 * in the composer and at send, so the string the reader was shown is the string
 * the send looks up, and a spelling the reader never saw cannot be answered by an
 * answer they did not give.
 */
async function answerDecision(action: "allow" | "deny", asked: string): Promise<GrantAnswer> {
  const reading = await readReadingRoot(process.cwd());
  if (reading.root === null) return { ok: false, reason: "no-root" };

  const admitted = await beyondRoot(reading, asked);
  if (!admitted.ok) return { ok: false, reason: admitted.reason };

  decide(asked, action === "allow" ? "allowed" : "denied");

  // The Grants as they stand, so a caller refreshing after an answer sees an
  // unchanged list — one decision about one message has widened nothing.
  return { ok: true, body: { root: reading.root, grants: reading.grants } };
}

/**
 * A path the reader named that lies beyond the Root, admitted by the walk.
 *
 * The one gate the two decisions share, so a Grant and an answer for a single
 * message cannot be admitted by two rules that might disagree about where a path
 * points. Bounded by the walk exactly as a Root is, and refused when the Root
 * already covers the path: nothing was ever asked about such a path, so recording
 * anything about it would be a claim no decision of the reader's backs.
 */
async function beyondRoot(
  reading: { root: string | null },
  asked: string,
): Promise<{ ok: true; path: string } | { ok: false; reason: Refusal }> {
  if (reading.root === null) return { ok: false, reason: "no-root" };

  const wanted = resolveAgainstRoot(reading.root, asked);
  const admitted = await admitUnder([walkBoundary()], wanted);

  if (!admitted.admitted) return { ok: false, reason: admitted.reason };

  const covered = await admitUnder([reading.root], admitted.path);
  if (covered.admitted) return { ok: false, reason: "already-decided" };

  return { ok: true, path: admitted.path };
}

/** A walk is a short local filesystem read; it needs no long ceiling. */
export const maxDuration = 30;
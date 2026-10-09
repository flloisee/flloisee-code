import { promises as fs } from "node:fs";

import { z } from "zod";

import { admitUnder } from "@/lib/roots/containment";
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
 * answer survives a restart.
 *
 * Two capabilities in one route, and each is bounded rather than trusted. The
 * route lists folders, so a caller who could name any path would turn it into a
 * map of the developer's machine; and it writes a file recording a folder, which
 * is a capability a deployed build must not have at all — the same reasoning as
 * Key Entry, and refused the same way.
 *
 * The browser does name a path, and that is deliberate rather than a compromise.
 * What it may only name is a path this route has just offered: every path below
 * goes through the same admission the rest of the feature is stood on, so a
 * caller can walk the reader's home folder and no further. The alternative —
 * the browser saying "the third entry of the second folder" and the server
 * keeping the map — is a second source of truth to invalidate, and it buys
 * nothing while the walk is bounded.
 *
 * POST and nothing else, for the reason the Key Entry route gives: under Cache
 * Components a GET Route Handler follows the prerender model of a page, and a
 * prerendered listing here would answer from a moment the developer never asked
 * about.
 */

const rootsRequestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("read") }).strict(),
  z.object({ action: z.literal("find"), path: z.string().min(1).optional() }).strict(),
  z.object({ action: z.literal("declare"), path: z.string().min(1) }).strict(),
  z.object({ action: z.literal("forget") }).strict(),
  // The two a Grant needs. The path is what the Model asked for and nothing
  // else — not a Root, not a boundary — because every one of those is the
  // server's to hold. `grant` resolves it against the Root the same way the
  // approval policy does, so the browser never gets to say where a Grant lands.
  z.object({ action: z.literal("grant"), path: z.string().min(1) }).strict(),
  z.object({ action: z.literal("revoke"), path: z.string().min(1) }).strict(),
]);

const MALFORMED_REQUEST =
  'Naming a Root takes one of "read", "find", "declare", "forget", "grant", or "revoke" — ' +
  'as { "action": "find", "path": ... } and so on.';

/**
 * What each refusal says.
 *
 * Every message names the cause and gives the reader something to do, and none
 * of them quotes a path back. A path in a refusal is one the caller chose, so
 * echoing it would disclose nothing — but the useful half of a refusal is what
 * to try instead, and a message that leads with the offending string reads as an
 * error report rather than as an answer.
 */
const REFUSED: Record<WalkRefusal, string> = {
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
};

/**
 * The two refusals that are about a Grant rather than about the walk.
 *
 * Not refusals of the walk: both are answers to a question the walk is never
 * asked, and folding them into `REFUSED` would have that map claiming to describe
 * every reason this route has — which is how a map stops being worth reading.
 */
const GRANT_REFUSED: Record<Exclude<Refusal, WalkRefusal>, string> = {
  "no-root":
    "No folder has been chosen for the Model to read, so there is nothing to allow " +
    "anything outside of. Choose a folder first.",
  "already-granted":
    "That path is already inside the folder the Model reads, so it is read without " +
    "asking — there is nothing to remember about it.",
};

/** Why this route will not do what it was asked: the walk's reasons, or a Grant's. */
type Refusal = WalkRefusal | "no-root" | "already-granted";

function refused(reason: Refusal): Response {
  return Response.json(
    {
      error:
        reason in REFUSED
          ? REFUSED[reason as WalkRefusal]
          : GRANT_REFUSED[reason as Exclude<Refusal, WalkRefusal>],
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

  const wanted = resolveAgainstRoot(reading.root, asked);
  const admitted = await admitUnder([walkBoundary()], wanted);

  if (!admitted.admitted) return { ok: false, reason: admitted.reason };

  const covered = await admitUnder([reading.root], admitted.path);
  if (covered.admitted) return { ok: false, reason: "already-granted" };

  await grantPath({ dir, path: admitted.path });
  const after = await readReadingRoot(dir);
  return { ok: true, body: { root: reading.root, grants: after.grants } };
}

/** A walk is a short local filesystem read; it needs no long ceiling. */
export const maxDuration = 30;
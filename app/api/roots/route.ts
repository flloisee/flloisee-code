import { promises as fs } from "node:fs";

import { z } from "zod";

import { admitUnder } from "@/lib/roots/containment";
import {
  declareRoot,
  forgetRoot,
  readReadingRoot,
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
]);

const MALFORMED_REQUEST =
  "Naming a Root takes one of \"read\", \"find\", \"declare\", or \"forget\" — " +
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

function refused(reason: WalkRefusal): Response {
  return Response.json({ error: REFUSED[reason] }, { status: 400 });
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
    return Response.json({ root: reading.root, malformed: reading.malformed });
  }

  if (action === "forget") {
    await forgetRoot({ dir: process.cwd() });
    return Response.json({ root: null });
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

/** A walk is a short local filesystem read; it needs no long ceiling. */
export const maxDuration = 30;
import { z } from "zod";

import { readRouteError, readRouteJSON } from "@/lib/http/route-answer";

/**
 * Naming a Reading Root, from the interface.
 *
 * Requests and answers, kept distinct rather than collapsed into worked or not.
 * The route's wording is deliberate — it names what was refused and what to do
 * instead — so it is passed up rather than replaced, and there is no path through
 * this module that could hold a file's contents: the walk answers with names and
 * paths, never with what is inside anything.
 *
 * **A path arriving here is one the server is going to resolve.** The reader never
 * types one and the Model's own spelling reaches us as relative to a Root this
 * module has never heard of. So nothing here resolves, normalises or checks a
 * path — it forwards what was said and reports what came back, which is the only
 * shape in which the browser and the server cannot disagree about where a Grant
 * lands.
 */

const listingSchema = z.object({
  path: z.string(),
  parent: z.string().nullable(),
  entries: z.array(z.object({ name: z.string(), path: z.string(), kind: z.enum(["directory", "file"]) })),
});

/** One row of a listing: what it is called, and where it really is. */
export type WalkEntry = z.infer<typeof listingSchema>["entries"][number];

export type RootListing =
  | { status: "listed"; path: string; parent: string | null; entries: WalkEntry[] }
  | { status: "refused"; message: string };

export type RootAnswer =
  /** The folder is recorded, and this is where the server says it is. */
  | { status: "declared"; root: string; grants: string[] }
  /** There is no Root, or the file holding one could not be understood. */
  | { status: "none"; malformed: boolean; grants: string[] }
  | { status: "refused"; message: string };

/**
 * What recording or taking back a Grant came back with.
 *
 * Not a `RootAnswer`, because neither of these changes the Root: a refusal to
 * grant a path says nothing about whether a folder is chosen, and folding the two
 * together would leave a caller unable to tell "the Grant was refused" from "the
 * Root went away", which are different facts about a different decision.
 */
export type GrantAnswer =
  | { status: "granted"; grants: string[] }
  | { status: "refused"; message: string };

/** The route could not be reached at all, which is not the same as a refusal. */
const UNREACHABLE = "Could not reach the app's Reading Root route.";

/**
 * Whether a Root can be named at all.
 *
 * The route refuses outside development, so an interface offering the control
 * everywhere would be offering one that can only fail. One place decides it, the
 * way `keyEntryIsAvailable` does, and the picker does not have to know why.
 */
export function rootNamingIsAvailable(): boolean {
  return process.env.NODE_ENV === "development";
}

function asStatus(status: number): number {
  // 0 means the route was never reached, which a caller has to be able to tell
  // apart from a route that ran and refused.
  return Number.isFinite(status) ? status : 0;
}

async function post(body: unknown): Promise<{ status: number; body: unknown }> {
  try {
    const response = await fetch("/api/roots", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await readRouteJSON(response) };
  } catch {
    return { status: 0, body: null };
  }
}

function refusalFrom(status: number, body: unknown): { status: "refused"; message: string } {
  if (status === 0) return { status: "refused", message: UNREACHABLE };

  return {
    status: "refused",
    message: readRouteError(body) ?? "The app refused that. Nothing was written.",
  };
}

function refused(status: number, body: unknown) {
  return refusalFrom(asStatus(status), body);
}

/** Reads one listing off the route's answer. */
export function readListing({ status, body }: { status: number; body: unknown }): RootListing {
  if (status !== 200) return refused(status, body);

  const parsed = listingSchema.safeParse(body);

  if (!parsed.success) {
    return { status: "refused", message: "The app's Reading Root route answered in an unexpected form." };
  }

  const { path, parent, entries } = parsed.data;
  return { status: "listed", path, parent, entries };
}

/** Asks for the folder to walk into. Without a path, it starts at the reader's home. */
export async function requestWalk(path?: string): Promise<RootListing> {
  return readListing(await post({ action: "find", ...(path ? { path } : {}) }));
}

/** Reads one answer about the Root itself off the route's answer. */
export function readRootAnswer({ status, body }: { status: number; body: unknown }): RootAnswer {
  if (status !== 200) return refused(status, body);

  const parsed = z
    .object({
      root: z.string().nullable(),
      // Defaulted rather than required, because a server that has never granted
      // anything is answering truthfully about a Root with none of them — and a
      // reader who has granted nothing should not be told the route is broken.
      grants: z.array(z.string()).default([]),
      malformed: z.boolean().optional(),
    })
    .safeParse(body);

  if (!parsed.success) {
    return { status: "refused", message: "The app's Reading Root route answered in an unexpected form." };
  }

  const { root, grants } = parsed.data;

  // `malformed` is kept rather than folded into "none": a Root that reads as
  // absent with nothing said is a Root that silently stopped being read, and the
  // reader is the one who can fix it.
  if (root === null) {
    return { status: "none", malformed: parsed.data.malformed ?? false, grants };
  }

  return { status: "declared", root, grants };
}

/** Reads an answer about a Grant off the route's answer. */
export function readGrantAnswer({ status, body }: { status: number; body: unknown }): GrantAnswer {
  if (status !== 200) return refused(status, body);

  const parsed = z.object({ grants: z.array(z.string()) }).safeParse(body);

  // No default here, unlike the Root's answer: a caller that pressed "always
  // allow" needs to know the list now in force, and a body without one is a
  // server that did not answer the question it was asked.
  if (!parsed.success) {
    return { status: "refused", message: "The app's Reading Root route answered in an unexpected form." };
  }

  return { status: "granted", grants: parsed.data.grants };
}

export async function readRoot(): Promise<RootAnswer> {
  return readRootAnswer(await post({ action: "read" }));
}

export async function declareRoot(folder: string): Promise<RootAnswer> {
  return readRootAnswer(await post({ action: "declare", path: folder }));
}

export async function forgetRoot(): Promise<RootAnswer> {
  return readRootAnswer(await post({ action: "forget" }));
}

/**
 * Asks for a path to be allowed from now on.
 *
 * The path is whatever the Model wrote, not a resolved one: the browser has no
 * Root and cannot resolve anything, and the route does it the same way the
 * approval policy does. So the Grant that ends up recorded is for the file the
 * reader was shown, rather than for wherever the browser guessed it was.
 */
export async function grantPath(asked: string): Promise<GrantAnswer> {
  return readGrantAnswer(await post({ action: "grant", path: asked }));
}

/**
 * Asks for a recorded path to be taken back.
 *
 * Named exactly as the route listed it, and never resolved first — the route
 * compares exactly too, and a caller that normalised the string here would be
 * asking to remove a Grant under a name the file does not hold.
 */
export async function revokeGrant(recorded: string): Promise<GrantAnswer> {
  return readGrantAnswer(await post({ action: "revoke", path: recorded }));
}
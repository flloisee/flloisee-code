import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Admitting a path to a set of boundaries, and nothing else.
 *
 * This is the primitive the whole feature is stood on: it is the only thing that
 * decides whether the Model may read a file. It takes a list of boundaries
 * rather than one, because a Grant is an addition to the Root and nothing else,
 * and a check that could only be asked about one boundary would be a check that
 * had to be written twice — once correctly and once in a hurry.
 *
 * Deliberately knows nothing about Roots, Grants or Tools. Which paths are the
 * boundaries is the caller's decision, so nothing here can be widened by a
 * change to what a Root is.
 */

/**
 * Why a path was refused.
 *
 * Three answers rather than two, because they ask different things of whoever
 * is told: `unusable` is a path that could never be read, `unreadable` is one
 * that is not there, and `outside` is one that is there and is not ours. A
 * reader sent to the wrong place by a message that does not distinguish them is
 * a failure the reader pays for in their own time.
 */
export type Refusal = "unusable" | "unreadable" | "outside";

export type Admission =
  | { admitted: true; path: string }
  | { admitted: false; reason: Refusal };

const REFUSED = { admitted: false, reason: "outside" } as const;

/**
 * Resolves a path the way the disk does, or reports that it cannot be resolved.
 *
 * `realpath`, not `resolve`: a `..` in the middle of a path is removed by
 * resolving, but a symlink in the middle of one is not, and the symlink is the
 * interesting case. Resolving first would follow the link and hand back a path
 * inside the boundary, which is precisely the outcome this must never produce.
 *
 * A path that does not exist cannot be resolved and cannot be read, and the two
 * are answered differently because the reader's next step differs: one is a typo
 * and the other is a permission.
 */
async function resolveOrRefuse(candidate: string): Promise<{ path: string } | { refusal: Refusal }> {
  // Absolute is checked before resolving rather than after, so the answer does
  // not depend on which directory the server was started in: `path.resolve`
  // would turn a relative path into an absolute one under the working
  // directory, which is inside the boundary on a machine started inside it and
  // outside on every other. A caller saying "inside the Root" has to say so
  // absolutely.
  if (!path.isAbsolute(candidate) || candidate.includes("\0")) return { refusal: "unusable" };

  try {
    return { path: await fs.realpath(candidate) };
  } catch (error) {
    return { refusal: codeOf(error) === "ENOENT" ? "unreadable" : "unusable" };
  }
}

function codeOf(error: unknown): string | undefined {
  return (error as { code?: string } | null)?.code;
}

/**
 * Whether `candidate` is one of the boundaries or sits under one of them.
 *
 * Order is fixed and load-bearing: resolve the candidate, resolve the
 * boundaries, compare. Both sides go through `realpath` because the boundary a
 * reader writes and the boundary the disk has can differ — a temporary directory
 * reached through a symlink is the everyday case here — and comparing one
 * against the other would refuse everything, which fails safe but uselessly.
 *
 * The comparison is `boundary + sep`, never a string prefix: `/…/project-other`
 * begins with `/…/project` and is not inside it.
 *
 * The answer is the resolved path rather than the one asked about, because that
 * is the only form a later check can compare, and because a caller that has been
 * told where a file really is can show it to the reader.
 *
 * A boundary that cannot be resolved admits nothing at all. It has no extent, so
 * any comparison against it would either always fail or — far worse — always
 * pass. Failing is the narrow answer, and narrow is what this function is for.
 */
export async function admitUnder(
  boundaries: readonly string[],
  candidate: string,
): Promise<Admission> {
  const asked = await resolveOrRefuse(candidate);
  if ("refusal" in asked) return { admitted: false, reason: asked.refusal };

  for (const boundary of boundaries) {
    const edge = await resolveOrRefuse(boundary);
    // A boundary that is not there, or is not a path, is skipped rather than
    // admitted: it has no extent, so nothing can be under it.
    if ("refusal" in edge) continue;

    if (asked.path === edge.path || asked.path.startsWith(edge.path + path.sep)) {
      return { admitted: true, path: asked.path };
    }
  }

  return REFUSED;
}
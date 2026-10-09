import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { admitUnder } from "./containment";

/**
 * Admitting a path to a set of boundaries, and nothing else.
 *
 * This is the primitive the rest of the feature stands on. It answers one
 * question — is this path a boundary, or under one, once both have been resolved
 * the way the disk actually is — and it answers it for any number of boundaries,
 * so the walk that picks a Root and the chat route that reads inside one are
 * asking it the same question rather than each having their own idea of what
 * "inside" means.
 *
 * It carries no policy and no vocabulary: it is not told what a Root or a Grant
 * is. Which paths are boundaries is decided by the caller, so nothing here can
 * be widened by something that widens one of those.
 */

/**
 * `mkdtemp` under the system temporary directory, which on macOS is reached
 * through a symlink (`/var` -> `/private/var`). That is useful rather than in the
 * way: every boundary below is written the way a reader would write it and
 * resolved the way the disk really is, and the two disagreeing is the case the
 * primitive exists to survive.
 *
 * Resolved once here so the expectations below can be written as literals: the
 * answers are resolved paths, and an expectation written unresolved would be
 * asserting the wrong thing rather than failing for a real reason.
 */
let project = "";

/** A null byte, as a character code: this file stays readable text. */
const NUL = String.fromCharCode(0);

beforeAll(async () => {
  project = await realpath(await mkdtemp(path.join(tmpdir(), "containment-")));
});

afterAll(async () => {
  await rm(project, { recursive: true, force: true });
});

async function aFolder(...segments: string[]): Promise<string> {
  const folder = path.join(project, ...segments);
  await mkdir(folder, { recursive: true });
  return folder;
}

async function aFile(...segments: string[]): Promise<string> {
  const file = path.join(project, ...segments);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, "contents", "utf8");
  return file;
}

/** The boundary every test below measures against, created on first use. */
async function resolvedBoundary(): Promise<string> {
  const boundary = path.join(project, "project");
  await mkdir(boundary, { recursive: true });
  return boundary;
}

describe("a path inside the boundary", () => {
  it("is admitted, as the path the disk actually has rather than the one asked about", async () => {
    const boundary = await resolvedBoundary();
    const readme = await aFile("project", "README.md");

    // Asked about through a symlink, answered as the file itself. The answer is
    // the resolved path because that is the only one later checks can compare.
    await symlink(readme, path.join(project, "link-to-readme"));

    expect(await admitUnder([boundary], path.join(project, "link-to-readme"))).toEqual({
      admitted: true,
      path: readme,
    });
  });

  it("admits the boundary itself, so the Root can be read as well as what is in it", async () => {
    const boundary = await resolvedBoundary();

    expect(await admitUnder([boundary], boundary)).toMatchObject({ admitted: true });
  });

  it("admits a path under any one of several boundaries, and under one alone", async () => {
    const boundary = await resolvedBoundary();
    const granted = await aFolder("documents");
    const elsewhere = await aFile("elsewhere", "notes.md");

    expect(await admitUnder([boundary, granted], granted)).toMatchObject({ admitted: true });
    expect(await admitUnder([boundary, granted], boundary)).toMatchObject({ admitted: true });
    expect(await admitUnder([boundary, granted], elsewhere)).toEqual({
      admitted: false,
      reason: "outside",
    });
  });
});

describe("a path outside the boundary", () => {
  it("is refused, and says so", async () => {
    const boundary = await resolvedBoundary();
    const other = await aFolder("project-other");

    expect(await admitUnder([boundary], other)).toEqual({ admitted: false, reason: "outside" });
  });

  it("is refused when it climbs out on the way, with the `..` still in the string", async () => {
    const boundary = await resolvedBoundary();
    await aFolder("project", "src");
    await aFile("project-other", "README.md");

    // Concatenated rather than joined, because `path.join` would collapse the
    // `..` before it arrived and the traversal would never be tested. This is
    // the shape a caller actually sends, and the reason the comparison is made
    // on resolved paths: by the time it is made, every `..` is gone.
    expect(
      await admitUnder([boundary], `${boundary}/../project-other/README.md`),
    ).toEqual({ admitted: false, reason: "outside" });
  });

  it("is refused when it is a sibling whose name merely begins the boundary's", async () => {
    // The case a string prefix gets wrong: `/…/project-other` starts with
    // `/…/project` and is not under it.
    const boundary = await resolvedBoundary();
    const secret = await aFile("project-other", "secrets.txt");

    expect(await admitUnder([boundary], secret)).toEqual({ admitted: false, reason: "outside" });
  });

  it("is refused under every boundary when it is under none of them", async () => {
    const boundary = await resolvedBoundary();
    const granted = await aFolder("documents");
    const elsewhere = await aFile("elsewhere", "notes.md");

    // Boundaries are additions and never a way around each other: a path is
    // admitted if it is under one of them, and by nothing else.
    expect(await admitUnder([boundary, granted], elsewhere)).toEqual({
      admitted: false,
      reason: "outside",
    });
  });
});

describe("a path that reaches out through a symlink", () => {
  it("is refused, because the link is resolved before the boundary is checked", async () => {
    const boundary = await resolvedBoundary();
    const inside = await aFolder("project", "notes");
    const outside = await aFolder("secrets");
    await writeFile(path.join(outside, "id_rsa"), "PRIVATE KEY", "utf8");
    await symlink(outside, path.join(inside, "escape-hatch"));

    // Checking containment before resolving would follow the link, find a path
    // inside the boundary, and let it through. The order is the whole of it.
    expect(await admitUnder([boundary], path.join(inside, "escape-hatch", "id_rsa"))).toEqual({
      admitted: false,
      reason: "outside",
    });
  });

  it("is refused through a link that points at another link that points out", async () => {
    const boundary = await resolvedBoundary();
    const inside = await aFolder("project", "notes");
    await aFolder("elsewhere");
    await symlink(path.join(project, "elsewhere"), path.join(project, "second-hop"));
    await symlink(path.join(project, "second-hop"), path.join(inside, "first-hop"));

    expect(await admitUnder([boundary], path.join(inside, "first-hop"))).toEqual({
      admitted: false,
      reason: "outside",
    });
  });
});

describe("a path that is not usable as one", () => {
  it("is refused as unusable when it carries a null byte, and as unreadable when there is nothing there", async () => {
    const boundary = await resolvedBoundary();
    await aFolder("project-other");

    // Two refusals that answer different questions, so they are asked apart: a
    // caller told "there is nothing there" about a path carrying a null byte
    // would go looking in the wrong place entirely. Built from a character code
    // rather than typed as an escape, so this file stays readable text.
    expect(await admitUnder([boundary], `${boundary}${NUL}/../project-other`)).toEqual({
      admitted: false,
      reason: "unusable",
    });
    expect(await admitUnder([boundary], path.join(boundary, "never-existed"))).toEqual({
      admitted: false,
      reason: "unreadable",
    });
  });

  it("is refused as unusable when it is relative, rather than resolved against wherever the server stands", async () => {
    const boundary = await resolvedBoundary();

    // `path.resolve` would turn this into `<the server's working directory>/secrets`,
    // which is inside the boundary on a machine started in it and outside on
    // every other. A caller that wants to say "inside the Root" has to say so
    // absolutely.
    expect(await admitUnder([boundary], "secrets")).toEqual({
      admitted: false,
      reason: "unusable",
    });
  });

  it("is refused as unreadable when there is nothing there", async () => {
    const boundary = await resolvedBoundary();

    expect(await admitUnder([boundary], path.join(boundary, "never-existed"))).toEqual({
      admitted: false,
      reason: "unreadable",
    });
  });
});

describe("a boundary that is not usable as one", () => {
  it("admits nothing at all, rather than admitting everything", async () => {
    await resolvedBoundary();

    // A boundary that cannot be resolved has no extent, and a comparison that
    // passed for anything would be the widest thing in the app. The narrow
    // answer is the only safe one.
    expect(await admitUnder([path.join(project, "never-existed")], project)).toEqual({
      admitted: false,
      reason: "outside",
    });
    expect(await admitUnder([], project)).toEqual({ admitted: false, reason: "outside" });
  });
});
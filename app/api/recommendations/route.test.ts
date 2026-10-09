import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/recommendations/route";
import { temporaryProject, type TemporaryProject } from "@/lib/testing/temporary-project";

/**
 * The recommendations route's input surface.
 *
 * The whole reason this route takes no Endpoint is that a reader asking what
 * they could run offline is not yet running anything. That is also the security
 * property: the route reaches Hugging Face, and a caller able to send search
 * terms or name a repository could turn this app into a proxy for fetching
 * something of their choosing.
 *
 * So what it takes is a number, bounded at both ends, and a choice from a closed
 * list of two. Every request here is one that is refused before anything leaves
 * the machine.
 */

const post = (body: unknown) =>
  POST(
    new Request("http://localhost/api/recommendations", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    }),
  );

describe("the recommendations route", () => {
  it("refuses a request naming an Endpoint", async () => {
    // The field this route used to have, and the one that would tie
    // recommendations to whatever happened to be loaded.
    expect((await post({ minTokensPerSecond: 50, endpointId: "ollama" })).status).toBe(400);
  });

  it("refuses a request trying to nominate what is looked up", async () => {
    // The shapes that would make it a proxy: search terms, a repository, a size.
    for (const extra of [
      { search: "qwen" },
      { repo: "someone/anything" },
      { model: "x/y" },
      { url: "https://elsewhere.example" },
      { maxBytes: 1 },
    ]) {
      const response = await post({ minTokensPerSecond: 50, ...extra });

      expect(response.status).toBe(400);
    }
  });

  it("refuses a speed that is not a sensible number", async () => {
    // Zero would divide by nothing when working out what fits; a huge number
    // asks for a Model no machine has. Both are refused rather than clamped,
    // so a caller that meant something else finds out.
    for (const minTokensPerSecond of [0, -1, 1.5, 100_000]) {
      expect((await post({ minTokensPerSecond })).status).toBe(400);
    }
  });

  it("refuses a request saying nothing at all", async () => {
    expect((await post({})).status).toBe(400);
  });

  it("refuses a fit that is not one of the two", async () => {
    // An open string here would be a caller naming behaviour this app has not
    // written, and the route deciding what to do about it. A closed list means a
    // new fit is a deliberate change to this schema and nowhere else.
    for (const rank of ["quality", "SPEED", "", "intelligence ", null, 1]) {
      expect((await post({ minTokensPerSecond: 50, rank })).status).toBe(400);
    }
  });

  it("still refuses a field that is neither a speed nor a fit", async () => {
    // The load-bearing check on `.strict()` itself, now that the schema has grown
    // a second field. Adding an allowed one must not have cost the guard that
    // turns everything else away: these are refused for *being extra*, not for
    // their values.
    for (const extra of [{ sort: "downloads" }, { limit: 100 }, { offset: 0 }, { order: "asc" }]) {
      const response = await post({ minTokensPerSecond: 50, rank: "intelligence", ...extra });

      expect(response.status).toBe(400);
    }
  });
});

/**
 * The requests it does accept.
 *
 * In a temporary project, because an accepted request goes on to read
 * `.endpoints.json` — the file that records the reader's own machines — and a
 * test that ran against the real one would be a test that read the developer's
 * network. Every other test in this file is refused before any of that, which is
 * the point of them.
 */
describe("the recommendations route on a request it accepts", () => {
  let project: TemporaryProject;

  beforeEach(async () => {
    project = await temporaryProject("recommendations-");
    await project.begin();
    // The Hub is stubbed, not reached. An empty listing is a real answer — it is
    // what a machine nothing on the Hub fits would get — and it keeps the test to
    // the probe rather than to the network.
    vi.stubGlobal("fetch", vi.fn(async () => new Response("[]", { status: 200 })));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await project.end();
  });

  it("takes either fit, and says so when given neither", async () => {
    // `rank` is optional so a caller that has never heard of it gets the default
    // rather than a 400 — which is exactly why leaving it out has to be *safe*.
    // It is: the enumeration closes the set at two, and the one that is absent is
    // the one this feature shipped with.
    for (const rank of ["speed", "intelligence", undefined]) {
      const response = await post({ minTokensPerSecond: 50, ...(rank === undefined ? {} : { rank }) });

      expect(response.status).toBe(200);
    }
  });
});
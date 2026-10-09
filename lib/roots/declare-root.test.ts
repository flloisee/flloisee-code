// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";

import { ROOT_CHANGED_KEY } from "./root-readout";
import { declareRoot, forgetRoot } from "./declare-root";

/**
 * That recording a Root is announced to the rest of the interface.
 *
 * The composer names the folder the Model may read, and it can only name the one
 * that is current. A reader who declares a folder in Settings and watches the
 * composer go on naming the last one is being told, quietly and continuously, that
 * their Responses are coming from somewhere they have just stopped reading — so the
 * announcement is tested here, at the one function every declaration goes through,
 * rather than inferred from the picker having refreshed.
 *
 * `fetch` is answered by hand rather than through the real route: what is under
 * test is that a *change* is broadcast, and the route's own answer — declared,
 * refused, none — is the other half of the condition, which these tests set
 * directly.
 */

const REAL_FETCH = globalThis.fetch;

/** Listeners taken down after each test, since a window outlives the file. */
const listeners: (() => void)[] = [];

afterEach(() => {
  globalThis.fetch = REAL_FETCH;
  while (listeners.length > 0) listeners.pop()!();
});

/**
 * The keys this window heard, in the order they were broadcast. A null key is
 * another window clearing storage outright, which this app also listens for.
 */
type Broadcasts = string[];

/** The route answers `body`, and every key broadcast to this window is collected. */
function routeAnswers(body: unknown): { announced: Broadcasts } {
  const announced: Broadcasts = [];
  const collect = (event: StorageEvent) => announced.push(event.key ?? "(storage cleared)");
  window.addEventListener("storage", collect);

  globalThis.fetch = (async () =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;

  listeners.push(() => window.removeEventListener("storage", collect));
  return { announced };
}

const DECLARED = { root: "/Users/someone/project", grants: [] };
const NONE = { root: null, grants: [] };

describe("recording a Root", () => {
  it("announces the change, so the composer names the folder just chosen", async () => {
    const { announced } = routeAnswers(DECLARED);

    await declareRoot("/Users/someone/project");

    expect(announced).toEqual([ROOT_CHANGED_KEY]);
  });

  it("says nothing when the folder was refused, because nothing changed", async () => {
    const { announced } = routeAnswers({ error: "That path is outside your home folder." });

    await declareRoot("../elsewhere");

    // A refusal leaves the folder exactly as it was. Announcing it would ask every
    // listener to re-read a Root they already have, and the one thing this broadcast
    // is for — a boundary that has moved — would have happened in neither case.
    expect(announced).toEqual([]);
  });

  it("announces a folder taken back, so the composer stops claiming one", async () => {
    const { announced } = routeAnswers(NONE);

    await forgetRoot();

    // Silence here would leave the composer naming a folder nothing is read from,
    // which is the same claim in the other direction.
    expect(announced).toEqual([ROOT_CHANGED_KEY]);
  });
});
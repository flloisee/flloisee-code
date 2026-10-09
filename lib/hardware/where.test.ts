import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { explainPlacement, whereModelsRun } from "./where";
import { temporaryProject } from "@/lib/testing/temporary-project";

/**
 * Working out whether the specs on screen describe the reader's machine.
 *
 * Every test here is about a case where answering confidently would be wrong.
 * The app and its Models are on one machine in ordinary use, and that is the
 * case where there is nothing to check — so these tests exist for the
 * arrangements where the answer would otherwise be a confident mistake.
 *
 * Inside `temporaryProject()` because `whereModelsRun` reads `.endpoints.json`,
 * and a test that read the developer's real one would describe their setup
 * rather than the case being tested.
 */

let project: Awaited<ReturnType<typeof temporaryProject>>;

beforeEach(async () => {
  project = await temporaryProject("where-models-");
  await project.begin();
});

afterEach(async () => {
  await project.end();
});

/** Writes a declared Endpoint at a given address. */
async function declareAt(baseURL: string): Promise<void> {
  const fs = await import("node:fs/promises");
  await fs.writeFile(
    project.endpointsFile(),
    JSON.stringify({
      endpoints: [
        { id: "somewhere", name: "Somewhere", baseURL, defaultModelId: "a-model", knownModels: ["a-model"], declared: true },
      ],
    }),
  );
}

describe("a Model server on this machine", () => {
  it("is recognised through the loopback address, however it is written", async () => {
    // `localhost` and `127.0.0.1` are both this machine, and a reader who wrote
    // one rather than the other should not be told their Models are elsewhere.
    for (const address of ["http://localhost:11434/v1", "http://127.0.0.1:1234/v1"]) {
      await declareAt(address);
      expect(await whereModelsRun(project.dir)).toEqual({ at: "here" });
    }
  });

  it("is recognised through one of this machine's own addresses", async () => {
    // The other spelling of "here": a reader who wrote their machine's LAN
    // address rather than loopback, which is what someone configuring Ollama
    // for use from a phone on the same network would do.
    const { networkInterfaces } = await import("node:os");

    const own = Object.values(networkInterfaces())
      .flat()
      .find((entry) => entry !== undefined && !entry.internal && entry.family === "IPv4")?.address;

    if (own === undefined) return;

    await declareAt(`http://${own}:11434/v1`);

    expect(await whereModelsRun(project.dir)).toEqual({ at: "here" });
  });

  it("has nothing to say, because the reader is not asking", async () => {
    // No line confirming your own machine is your own machine. It would be noise
    // in the common case, and every line in this section is a line someone reads.
    await declareAt("http://127.0.0.1:11434/v1");

    expect(explainPlacement({ at: "here" })).toBeNull();
  });
});

describe("a Model server on another machine", () => {
  it("is recognised as elsewhere, and named", async () => {
    // The case that would mislead. The app is on the reader's machine, Ollama
    // is on the NAS, and the probe reports the wrong box's chips.
    await declareAt("http://192.168.1.50:11434/v1");

    const placement = await whereModelsRun(project.dir);

    expect(placement.at).toBe("elsewhere");
    expect(explainPlacement(placement)).toContain("192.168.1.50");
  });

  it("says which machine the specs do describe", async () => {
    // The reader needs to know what the numbers are about, not merely that
    // something is wrong. "Fits are not shown" without that leaves them
    // guessing which machine was measured.
    await declareAt("http://192.168.1.50:11434/v1");

    expect(explainPlacement(await whereModelsRun(project.dir))).toContain("this machine");
  });

  it("is recognised when the address is on this network but not this machine", async () => {
    // A private address that is not ours is still another machine. Treating
    // "on the LAN" as "local" would reintroduce the whole problem.
    await declareAt("http://10.0.0.4:8000/v1");

    expect((await whereModelsRun(project.dir)).at).toBe("elsewhere");
  });
});

describe("a reader using only the Endpoints declared in source", () => {
  it("is treated as running here, because those addresses are loopback", async () => {
    // The Registry always carries Ollama and LM Studio, both on loopback, so no
    // configuration makes this answer "unknown". That is deliberate: those two
    // are declared as candidates rather than confirmed servers, and a reader
    // who has declared nothing of their own is working on the assumption their
    // Models are here.
    //
    // What this therefore cannot catch is the app hosted somewhere remote with
    // only Cloud Endpoints — the specs would describe the host. That is out of
    // scope by a decision recorded in the README, and catching it would mean
    // probing whether something is listening at an address the reader never
    // named.
    expect(await whereModelsRun(project.dir)).toEqual({ at: "here" });
  });

  it("is shown no warning that would mean nothing to them", async () => {
    expect(explainPlacement(await whereModelsRun(project.dir))).toBeNull();
  });
});

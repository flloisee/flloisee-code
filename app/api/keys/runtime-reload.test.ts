import { writeFile } from "node:fs/promises";

import { loadEnvConfig } from "@next/env";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { setEnvVar, temporaryProject } from "@/lib/testing/temporary-project";

import { POST } from "./route";

/**
 * Key Entry in a server that has already started, which is the only situation
 * that ever occurs.
 *
 * Next reads the environment when it boots, and that read leaves two things
 * behind: the loader's own memoised result, and a marker on the environment
 * that makes a later plain call return without reading anything. A save that
 * did not force the reload would therefore change the file and nothing else —
 * silently, and only in a running server.
 *
 * Primed here the way a boot primes it. Without this, the tests elsewhere would
 * pass even with the reload's one non-optional argument dropped, because nothing
 * in a test process has read the environment before.
 */

const DECLARED = "OPENROUTER_API_KEY";

const project = await temporaryProject();
const { begin, end } = project;

// The boot, with an environment file present — which is when the loader both
// memoises its result and marks the environment as already processed.
beforeAll(async () => {
  await begin();
  await writeFile(project.envFile(), "UNRELATED_SETTING=keep-me\n", "utf8");
  loadEnvConfig(project.dir, true, undefined);
});

beforeEach(async () => {
  await begin();
  setEnvVar(DECLARED, undefined);
  await writeFile(project.envFile(), "UNRELATED_SETTING=keep-me\n", "utf8");
});

afterEach(end);

function enterKey(body: unknown): Promise<Response> {
  return POST(
    new Request("http://localhost/api/keys", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

describe("Key Entry once the server is running", () => {
  it("runs against an environment that has already been loaded once", () => {
    // The precondition, stated so that a failure above means what it looks
    // like: this is the marker the loader short-circuits on when it is not
    // forced, and it is set because the boot read above already ran.
    expect(process.env.__NEXT_PROCESSED_ENV).toBe("true");
  });

  it("still has the Credential live in the same request", async () => {
    const response = await enterKey({ envVar: DECLARED, credential: "sk-after-boot" });

    expect(response.status).toBe(200);
    expect(process.env[DECLARED]).toBe("sk-after-boot");
  });
});
import { readFile, writeFile } from "node:fs/promises";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { setEnvVar, temporaryProject } from "@/lib/testing/temporary-project";

import { POST } from "./route";

/**
 * What happens when a Credential is already in the environment before the app
 * starts, as it is when a developer runs `OPENROUTER_API_KEY=sk-... pnpm dev`.
 *
 * In its own file because it depends on where in the process's life the
 * environment is first read: the loader keeps a snapshot of the environment as
 * it was at that moment and rebuilds from it on every reload, so a name is only
 * shadowing the file if it was present then. Set before the project takes its
 * snapshot, the way a shell sets it before Next boots.
 */

const DECLARED = "OPENROUTER_API_KEY";
const FROM_THE_SHELL = "sk-from-the-shell";

setEnvVar(DECLARED, FROM_THE_SHELL);

const project = await temporaryProject();
const { begin, end } = project;

beforeEach(async () => {
  await begin();
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

describe("Key Entry for a variable the environment already carries", () => {
  it("says the environment is shadowing the file, rather than claiming the save worked", async () => {
    const response = await enterKey({ envVar: DECLARED, credential: "sk-from-the-form" });

    // The loader skips names already present in the environment, so the file's
    // value never wins. Saying the save succeeded would be a lie the developer
    // cannot act on; this says what to do about it.
    expect(await response.json()).toEqual({
      envVar: DECLARED,
      applied: false,
      shadowedByShell: true,
    });
    expect(process.env[DECLARED]).toBe(FROM_THE_SHELL);
  });

  it("still stores the Credential, so it takes effect once the export is gone", async () => {
    await enterKey({ envVar: DECLARED, credential: "sk-from-the-form" });

    expect(await readFile(project.envFile(), "utf8")).toContain(`${DECLARED}=sk-from-the-form`);
  });
});
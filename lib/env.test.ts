import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  setEnvVar,
  temporaryProject,
  type TemporaryProject,
} from "@/lib/testing/temporary-project";

import { canBeStoredVerbatim, saveAndReloadEnvValue, type TempFileWriter } from "./env";

/**
 * The write and the reload, tested where they meet the disk.
 *
 * Key Entry's file handling is the only place a developer's existing keys are at
 * risk, so most of these are about what survives a bad outcome rather than the
 * happy path: an interrupted write, a value that needs quoting, a name that is
 * already in the file.
 */

const DECLARED = "OPENROUTER_API_KEY";

const project: TemporaryProject = await temporaryProject();
const { begin, end, envFile } = project;

beforeEach(async () => {
  await begin();
  setEnvVar(DECLARED, undefined);
});

afterEach(end);

async function readEnvFile(): Promise<string> {
  return readFile(envFile(), "utf8");
}

describe("a file a developer has annotated", () => {
  it("keeps its comments, quoting, and ordering, changing only the value it was asked to change", async () => {
    const annotated = [
      "# Credentials entered here are not committed.",
      "",
      "# rotated last month",
      "export OPENROUTER_API_KEY=sk-old  # keep private",
      'UNRELATED_SETTING="quoted value"',
      "LAST_LINE_NO_NEWLINE=1",
    ].join("\n");
    await writeFile(envFile(), annotated, "utf8");

    await saveAndReloadEnvValue({ name: DECLARED, value: "sk-new", dir: project.dir });

    expect(await readEnvFile()).toBe(
      [
        "# Credentials entered here are not committed.",
        "",
        "# rotated last month",
        "export OPENROUTER_API_KEY=sk-new  # keep private",
        'UNRELATED_SETTING="quoted value"',
        "LAST_LINE_NO_NEWLINE=1",
      ].join("\n"),
    );
  });
});

describe("a Credential the file has to quote", () => {
  it("comes back out of the file exactly as it was typed", async () => {
    // Spaces, a `#`, a backslash, `=`, and a leading and trailing space: none
    // of which a dotenv line can hold bare, all of which a quoted one holds
    // exactly. Asserted through the reload, because that is where a mangled
    // value would otherwise show up.
    const credential = " sk-a b#c\\d=e ";

    const outcome = await saveAndReloadEnvValue({
      name: DECLARED,
      value: credential,
      dir: project.dir,
    });

    expect(outcome.applied).toBe(true);
    expect(process.env[DECLARED]).toBe(credential);
    expect(await readEnvFile()).toContain(`${DECLARED}=" sk-a b#c\\d=e "`);
  });
});

describe("a file that already holds two entries for one name", () => {
  it("leaves one, since only the last would ever be read", async () => {
    await writeFile(
      envFile(),
      "OPENROUTER_API_KEY=sk-old\nOTHER=keep\nOPENROUTER_API_KEY=sk-older\n",
      "utf8",
    );

    await saveAndReloadEnvValue({ name: DECLARED, value: "sk-new", dir: project.dir });

    expect(await readEnvFile()).toBe("OPENROUTER_API_KEY=sk-new\nOTHER=keep\n");
    expect(process.env[DECLARED]).toBe("sk-new");
  });
});

describe("the file holding a Credential", () => {
  it("is readable only by its owner", async () => {
    await saveAndReloadEnvValue({ name: DECLARED, value: "sk-secret", dir: project.dir });

    expect((await stat(envFile())).mode & 0o777).toBe(0o600);
  });
});

describe("the file it writes", () => {
  it("is excluded from version control, as is the temporary file it writes first", () => {
    // A Credential must never be committable, including in the instant before it
    // is renamed into place. Asked of git rather than of the .gitignore text, so
    // the question is answered by the same thing that would decide it.
    const repoRoot = fileURLToPath(new URL("..", import.meta.url));

    for (const name of [".env.local", ".key-entry-12345.tmp"]) {
      const check = spawnSync("git", ["check-ignore", "-q", name], { cwd: repoRoot });

      expect([name, check.status]).toEqual([name, 0]);
    }
  });
});

describe("the environment the reload rebuilds", () => {
  it("drops a variable that existed only in memory, as the loader replaces the environment", async () => {
    // Worth stating rather than assuming: this is why nothing here keeps a
    // resolved Credential in memory, and why a save has to be the thing that
    // notices the environment moved.
    setEnvVar("SET_ONLY_IN_MEMORY", "wiped");

    await saveAndReloadEnvValue({ name: DECLARED, value: "sk-written", dir: project.dir });

    expect(process.env.SET_ONLY_IN_MEMORY).toBeUndefined();
    expect(process.env[DECLARED]).toBe("sk-written");
  });
});

describe("a write interrupted part way through", () => {
  it("leaves the previous keys readable and no half-written Credential on disk", async () => {
    const existing = "# my keys\nUNRELATED_SETTING=keep-me\n";
    await writeFile(envFile(), existing, "utf8");

    // The process dies after writing part of the temporary file: the case the
    // temporary-file-and-rename dance exists for.
    const interrupted: TempFileWriter = async (tempPath) => {
      await writeFile(tempPath, "OPENROUTER_API_KEY=sk-half-wr", "utf8");
      throw new Error("interrupted");
    };

    await expect(
      saveAndReloadEnvValue({
        name: DECLARED,
        value: "sk-written",
        dir: project.dir,
        writeTempFile: interrupted,
      }),
    ).rejects.toThrow("interrupted");

    expect(await readEnvFile()).toBe(existing);
    // Nothing left behind that could be committed, or read back as a Credential.
    expect(await readdir(project.dir)).toEqual([".env.local"]);
    expect(process.env[DECLARED]).toBeUndefined();
  });
});
/**
 * Which values the environment file can hold back exactly.
 *
 * The predicate behind the route's refusal, so it is tested on its own rather
 * than only through the route. Every character listed here was measured against
 * the installed loader; a value that does not survive the round trip is stored
 * and looks stored, and then fails at the Endpoint with nothing to connect it to
 * what was typed. Refusing is the honest answer.
 */
describe("whether a Credential survives the environment file", () => {
  it("accepts an ordinary Credential, which is the case that matters", () => {
    expect(canBeStoredVerbatim("sk-or-v1-abc123_-.~")).toBe(true);
  });

  it("accepts the characters that do survive, however awkward they look", () => {
    // Spaces and `#` are quoted on write and come back unchanged, so refusing
    // them would refuse valid Credentials for no gain.
    expect(canBeStoredVerbatim("sk with spaces")).toBe(true);
    expect(canBeStoredVerbatim("sk#with#hashes")).toBe(true);
    expect(canBeStoredVerbatim("sk'with'quotes")).toBe(true);
    expect(canBeStoredVerbatim("sk\\with\\backslash")).toBe(true);
    expect(canBeStoredVerbatim("sk=with=equals")).toBe(true);
    expect(canBeStoredVerbatim("")).toBe(true);
  });

  it("refuses a value the loader would interpolate against the environment", () => {
    // `sk-$USER` is read back as whatever USER happens to be, which is a
    // different Credential rather than a mangled one.
    expect(canBeStoredVerbatim("sk-$USER")).toBe(false);
  });

  it("refuses a quote, which the file cannot represent without leaving the escape in", () => {
    expect(canBeStoredVerbatim('sk-"quoted')).toBe(false);
  });

  it("refuses a line break, which would end the entry and start a second assignment", () => {
    expect(canBeStoredVerbatim("sk-first\nOPENROUTER_API_KEY=attacker-controlled")).toBe(false);
    expect(canBeStoredVerbatim("sk-first\ropen")).toBe(false);
  });

  it("refuses a null byte, which the loader truncates at rather than rejecting", () => {
    // Measured, not assumed: writing `a\0b` and reloading yields `a`. The rest
    // of a Credential would be silently dropped rather than refused.
    expect(canBeStoredVerbatim("sk-\0truncated")).toBe(false);
  });
});

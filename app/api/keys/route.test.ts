import { readFile, writeFile } from "node:fs/promises";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { describeEndpoints } from "@/lib/endpoints/status";
import { declareEndpoint } from "@/lib/endpoints/custom";
import { RESERVED_ENDPOINT_IDS } from "@/lib/endpoints/registry";
import {
  setEnvVar,
  temporaryProject,
  type TemporaryProject,
} from "@/lib/testing/temporary-project";

import { POST } from "./route";

/**
 * Key Entry — the only place in the app that writes a file, and the only place
 * a Credential arrives. That makes it the route where a mistake writes someone
 * else's key into the wrong place, or hands a stored key back out.
 *
 * Every test drives the real Route Handler against a throwaway project
 * directory: the handler reads its target from the working directory, so
 * pointing that at a temporary directory exercises the real file writes without
 * ever touching the `.env.local` a developer depends on.
 */

/** A variable name the Catalog declares, so a rejection can only be about the rules. */
const DECLARED = "OPENROUTER_API_KEY";

const project: TemporaryProject = await temporaryProject();
const { begin, end } = project;

beforeEach(async () => {
  await begin();
  setEnvVar(DECLARED, undefined);
  await writeFile(
    project.envFile(),
    ["# Credentials entered here are not committed.", "UNRELATED_SETTING=keep-me", ""].join("\n"),
    "utf8",
  );
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

async function readEnvFile(): Promise<string> {
  return readFile(project.envFile(), "utf8");
}

describe("Key Entry outside development", () => {
  it("refuses to write a Credential, so no deployed build carries the capability", async () => {
    setEnvVar("NODE_ENV", "production");

    const response = await enterKey({ envVar: DECLARED, credential: "sk-test-value" });

    expect(response.status).toBe(404);
    expect(await readEnvFile()).not.toContain("sk-test-value");
  });
});

describe("Key Entry in development", () => {
  it("has the Credential live in the same request, so the next Request cannot be sent without it", async () => {
    const response = await enterKey({ envVar: DECLARED, credential: "sk-live-123" });

    expect(response.status).toBe(200);
    // Read in the same request that wrote it, with no pause for a watcher to
    // run. Relying on the watcher was measured at 2/15 under `next dev`.
    expect(process.env[DECLARED]).toBe("sk-live-123");
  });
});

describe("the variable names Key Entry will accept", () => {
  it("rejects a name the Catalog does not declare, and writes nothing", async () => {
    const before = await readEnvFile();

    const response = await enterKey({ envVar: "AWS_SECRET_ACCESS_KEY", credential: "stolen" });

    expect(response.status).toBe(400);
    expect(await readEnvFile()).toBe(before);
    expect(process.env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
  });

  it("refuses a base URL supplied in the request, so a Credential cannot be aimed elsewhere", async () => {
    const before = await readEnvFile();

    // Whatever the field is called, the answer is the same: the Catalog decides
    // where a Credential goes, and a caller who can also choose the address can
    // choose where it is sent. Checked under several plausible names, because
    // rejecting only the one spelled in a test proves nothing about the others.
    for (const field of ["baseURL", "baseUrl", "endpointUrl", "url"]) {
      const response = await enterKey({
        envVar: DECLARED,
        credential: "sk-attacker",
        [field]: "https://evil.example/v1",
      });

      expect([field, response.status]).toEqual([field, 400]);
    }

    expect(await readEnvFile()).toBe(before);
    expect(process.env[DECLARED]).toBeUndefined();
  });
});

describe("a Credential the file cannot hold back exactly", () => {
  it("refuses one carrying a line break, which would smuggle in a second entry", async () => {
    const response = await enterKey({
      envVar: DECLARED,
      credential: "sk-typed\nAWS_SECRET_ACCESS_KEY=stolen",
    });

    expect(response.status).toBe(400);
    expect(await readEnvFile()).not.toContain("AWS_SECRET_ACCESS_KEY");
    expect(process.env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
  });

  it("refuses one containing a quote or a dollar sign, rather than storing something else", async () => {
    // A dollar sign is interpolated out of the value on load, and a quote is
    // stored with its escape in front of it: both round-trip to a Credential
    // that is not the one typed, which is worse than not saving at all.
    for (const character of ['"', "$"]) {
      const response = await enterKey({
        envVar: DECLARED,
        credential: `sk-typed${character}tail`,
      });

      expect([character, response.status]).toEqual([character, 400]);
    }

    expect(await readEnvFile()).not.toContain("sk-typed");
    expect(process.env[DECLARED]).toBeUndefined();
  });
});

describe("the file Key Entry rewrites", () => {
  it("leaves the developer's comments and unrelated variables exactly as they were", async () => {
    await enterKey({ envVar: DECLARED, credential: "sk-written-555" });

    const file = await readEnvFile();

    expect(file).toContain("# Credentials entered here are not committed.");
    expect(file).toContain("UNRELATED_SETTING=keep-me");
    expect(file).toContain(`${DECLARED}=sk-written-555`);
  });

  it("leaves a Credential that was already stored as a single entry, not two that disagree", async () => {
    await enterKey({ envVar: DECLARED, credential: "sk-first" });
    await enterKey({ envVar: DECLARED, credential: "sk-second" });

    const entries = (await readEnvFile())
      .split("\n")
      .filter((line) => line.startsWith(`${DECLARED}=`));

    expect(entries).toEqual([`${DECLARED}=sk-second`]);
  });
});

describe("an Endpoint after Key Entry", () => {
  it("is Configured for the next Request, and stays Configured through a later save", async () => {
    const configured = async () =>
      (await describeEndpoints(process.env, project.dir)).statuses.find(
        (endpoint) => endpoint.id === "openrouter",
      )?.configured;

    expect(await configured()).toBe(false);

    await enterKey({ envVar: DECLARED, credential: "sk-first" });
    expect(await configured()).toBe(true);

    // A second Key Entry reloads the environment again, which rebuilds it from
    // the file. The first Credential is not in anyone's memory by now, so this
    // is where a Credential would be lost if only in-memory state carried it.
    await enterKey({ envVar: "GROQ_API_KEY", credential: "sk-second" });
    expect(await configured()).toBe(true);
  });
});

describe("Key Entry for an Endpoint the reader declared", () => {
  // A custom Endpoint's Credential is written when it is declared. Key Entry
  // taking a replacement is what makes a rotated key fixable without declaring
  // the whole Endpoint again — so the route's bound on writable names had to
  // widen, and these are the properties it had to keep while doing so.

  const CUSTOM = "CUSTOM_MY_SERVER_API_KEY";

  async function declareWithCredential() {
    await declareEndpoint({
      dir: project.dir,
      name: "My server",
      baseURL: "http://localhost:8000/v1",
      models: ["qwen3-coder"],
      credential: "sk-the-original",
      reserved: RESERVED_ENDPOINT_IDS,
    });
  }

  it("writes a replacement under the name derived from the Endpoint's own id", async () => {
    await declareWithCredential();

    const response = await enterKey({ envVar: CUSTOM, credential: "sk-a-replacement" });

    expect(response.status).toBe(200);
    expect(await readEnvFile()).toContain(`${CUSTOM}=sk-a-replacement`);
  });

  it("still refuses a name no Endpoint declares, so a caller cannot invent one", async () => {
    await declareWithCredential();

    const response = await enterKey({
      envVar: "CUSTOM_NO_SUCH_ENDPOINT_API_KEY",
      credential: "sk-somewhere-else",
    });

    expect(response.status).toBe(400);
    expect(await readEnvFile()).not.toContain("sk-somewhere-else");
  });

  it("still refuses a body carrying an address, for the reason it always did", async () => {
    // Widening the set of writable names must not have widened what may be
    // written beside one. A Catalog Credential redirected by this route would
    // be the failure the whole schema exists to prevent.
    await declareWithCredential();

    const response = await enterKey({
      envVar: CUSTOM,
      credential: "sk-a-key",
      baseURL: "https://evil.example/v1",
    });

    expect(response.status).toBe(400);
    expect(await readEnvFile()).not.toContain("sk-a-key");
  });

  it("makes the declared Endpoint Configured again after the replacement", async () => {
    await declareWithCredential();
    delete process.env[CUSTOM];

    expect(
      (await describeEndpoints(process.env, project.dir)).statuses.find(
        (endpoint) => endpoint.id === "my-server",
      )?.configured,
    ).toBe(false);

    await enterKey({ envVar: CUSTOM, credential: "sk-a-replacement" });

    expect(
      (await describeEndpoints(process.env, project.dir)).statuses.find(
        (endpoint) => endpoint.id === "my-server",
      )?.configured,
    ).toBe(true);
  });
});

describe("what Key Entry returns", () => {
  it("reports which variable is set and whether it is live, never the Credential itself", async () => {
    const credential = "sk-never-echoed-9876";

    const response = await enterKey({ envVar: DECLARED, credential });
    const body = await response.text();

    expect(body).not.toContain(credential);
    expect(JSON.parse(body)).toEqual({
      envVar: DECLARED,
      applied: true,
      shadowedByShell: false,
    });
  });
});
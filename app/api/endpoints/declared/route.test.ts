import { readFile } from "node:fs/promises";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { credentialVarFor } from "@/lib/endpoints/custom";
import { RESERVED_ENDPOINT_IDS } from "@/lib/endpoints/registry";
import {
  setEnvVar,
  temporaryProject,
  type TemporaryProject,
} from "@/lib/testing/temporary-project";

import { POST } from "./route";

/**
 * Declaring an Endpoint of one's own — the route where this app's guardrail
 * moved, so the route where a mistake matters most.
 *
 * The properties tested here are the ones the old design had and this one had to
 * keep: a Credential never lands anywhere but the environment file, a body
 * carrying an address is refused rather than honoured, and the whole capability
 * does not exist outside development.
 */

const project: TemporaryProject = await temporaryProject("declared-route-");
const { begin, end } = project;

beforeEach(async () => {
  await begin();
});

afterEach(end);

function declare(body: unknown): Promise<Response> {
  return POST(
    new Request("http://localhost/api/endpoints/declared", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

const A_SERVER = {
  action: "declare",
  name: "My server",
  baseURL: "http://localhost:8000/v1",
  models: ["qwen3-coder"],
};

describe("declaring outside development", () => {
  it("refuses, so no deployed build can write a file and reach a named address", async () => {
    setEnvVar("NODE_ENV", "production");

    const response = await declare(A_SERVER);

    expect(response.status).toBe(404);
    // The wording says why, because a reader cannot work that out unaided.
    expect(await response.text()).toContain("development");
    await expect(readFile(project.endpointsFile(), "utf8")).rejects.toThrow();
  });
});

describe("a Credential sent to this route", () => {
  it("is written to the environment file and never echoed back", async () => {
    const secret = "sk-never-echoed-4321";

    const response = await declare({ ...A_SERVER, credential: secret });

    expect(response.status).toBe(200);
    expect(await response.text()).not.toContain(secret);
    expect(await readFile(project.envFile(), "utf8")).toContain(secret);
  });

  it("is not written into .endpoints.json, which a developer may read and share", async () => {
    await declare({ ...A_SERVER, credential: "sk-kept-out-of-the-config" });

    expect(await readFile(project.endpointsFile(), "utf8")).not.toContain("sk-kept-out");
  });

  it("is refused, with nothing written, when it could not survive the environment file", async () => {
    const response = await declare({ ...A_SERVER, credential: "sk-with-a$dollar" });

    expect(response.status).toBe(400);
    expect(await response.text()).toContain("Nothing was written");
  });
});

describe("a body carrying more than this route takes", () => {
  it("is refused rather than quietly ignored, since silence would look like consent", async () => {
    // The rule `/api/keys` has always had: a caller that expected a field to be
    // honoured and got no answer would read the absence as agreement.
    const response = await declare({ ...A_SERVER, somethingElse: "surprise" });

    expect(response.status).toBe(400);
    expect(await response.text()).toContain("only the fields it lists");
  });

  it("cannot carry an address for an Endpoint that already exists", async () => {
    // Changing where a Catalog Endpoint is reached would redirect a Credential
    // somebody else is holding. The Catalog's addresses stay in source.
    const response = await declare({ ...A_SERVER, name: "Ollama", id: "ollama" });

    expect(response.status).toBe(400);
  });

  it("cannot take an id the Registry already holds", async () => {
    const response = await declare({ ...A_SERVER, name: "Ollama" });

    expect(response.status).toBe(400);
    expect(await response.text()).toContain("already");
    expect(RESERVED_ENDPOINT_IDS.has("ollama")).toBe(true);
  });
});

describe("a base URL sent to this route", () => {
  it("is refused unless it is an http or https address this app can reach", async () => {
    for (const baseURL of [
      "file:///etc/passwd",
      "ftp://example.com",
      "http://user:hunter2@localhost:8000/v1",
      "localhost:8000",
      "not a url at all",
    ]) {
      const response = await declare({ ...A_SERVER, baseURL });
      expect(response.status, baseURL).toBe(400);
    }

    await expect(readFile(project.endpointsFile(), "utf8")).rejects.toThrow();
  });
});

describe("what the route answers with", () => {
  it("names the Endpoint and the Model it will use, and no Credential value", async () => {
    const response = await declare({ ...A_SERVER, credential: "sk-silent-1234" });

    const body = await response.json();

    expect(body.endpoint).toEqual({
      id: "my-server",
      name: "My server",
      baseURL: "http://localhost:8000/v1",
      defaultModelId: "qwen3-coder",
      knownModels: ["qwen3-coder"],
      credentialEnvVar: "CUSTOM_MY_SERVER_API_KEY",
    });
    expect(body.credential.written).toBe(true);
    expect(JSON.stringify(body)).not.toContain("sk-silent-1234");
  });

  it("reports no Credential needed as a success, not an absence", async () => {
    // The ordinary case for a server on the reader's own machine. An answer that
    // read as a failure would make the common path look like the broken one.
    const body = await (await declare(A_SERVER)).json();

    expect(body.credential).toEqual({ written: false, envVar: null, reason: "notNeeded" });
  });

  it("refuses a malformed request in words that say what it wanted", async () => {
    const response = await declare({ action: "declare" });

    expect(response.status).toBe(400);
    expect(await response.text()).toContain("baseURL");
  });
});

describe("forgetting an Endpoint", () => {
  it("takes the Endpoint and the Credential off together", async () => {
    await declare({ ...A_SERVER, credential: "sk-going-away" });

    const response = await declare({ action: "forget", id: "my-server" });

    expect(await response.json()).toEqual({ forgotten: "my-server" });
    expect(await readFile(project.endpointsFile(), "utf8")).not.toContain("localhost:8000");
    expect(await readFile(project.envFile(), "utf8")).not.toContain("sk-going-away");
  });

  it("is refused outside development too", async () => {
    setEnvVar("NODE_ENV", "production");

    const response = await declare({ action: "forget", id: "my-server" });

    expect(response.status).toBe(404);
  });

  it("reports a forgotten Endpoint under the variable name its Credential used", async () => {
    // Naming it on the way out is what lets the interface say which line went,
    // rather than only that something was removed.
    await declare({ ...A_SERVER, credential: "sk-named" });
    await declare({ action: "forget", id: "my-server" });

    expect(await readFile(project.envFile(), "utf8")).not.toContain(credentialVarFor("my-server"));
  });
});

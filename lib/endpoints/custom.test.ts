import { readFile, writeFile } from "node:fs/promises";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  ENDPOINTS_FILE,
  credentialVarFor,
  declareEndpoint,
  forgetEndpoint,
  normaliseBaseURL,
  readDeclaredEndpoints,
  slugFor,
} from "./custom";
import { RESERVED_ENDPOINT_IDS } from "./registry";
import {
  temporaryProject,
  type TemporaryProject,
} from "@/lib/testing/temporary-project";

/**
 * The Endpoints a reader declares, and the checks that stand in for the source
 * control the Catalog has.
 *
 * Every test runs against a throwaway project directory rather than the
 * repository, because this module writes real files and reloads the process
 * environment. Pointing it at the real project would mean a test declaring an
 * Endpoint the developer then finds in their own settings.
 */

const project: TemporaryProject = await temporaryProject("declared-endpoints-");
const { begin, end } = project;

beforeEach(async () => {
  await begin();
});

afterEach(end);

const NOTHING_RESERVED: ReadonlySet<string> = new Set();

function declare(overrides: Partial<Parameters<typeof declareEndpoint>[0]> = {}) {
  return declareEndpoint({
    dir: project.dir,
    name: "My server",
    baseURL: "http://localhost:8000/v1",
    models: ["qwen3-coder"],
    reserved: NOTHING_RESERVED,
    ...overrides,
  });
}

async function readFileText(): Promise<string> {
  return readFile(project.endpointsFile(), "utf8");
}

async function readEnvFile(): Promise<string> {
  return readFile(project.envFile(), "utf8").catch(() => "");
}

describe("a base URL", () => {
  it("keeps the path the reader typed, and drops a trailing slash", () => {
    // Two readers typing the same server three ways must produce one string, or
    // Model Discovery builds three different URLs for one Endpoint.
    const first = normaliseBaseURL("http://localhost:8000/v1");
    const second = normaliseBaseURL("http://localhost:8000/v1/");
    const third = normaliseBaseURL("  http://localhost:8000/v1  ");

    expect(first).toEqual({ ok: true, baseURL: "http://localhost:8000/v1" });
    expect(second).toEqual(first);
    expect(third).toEqual(first);
  });

  it("refuses anything that is not http or https", () => {
    // `file:` would have the server read outside the HTTP contract the SDK
    // speaks, and the Proxying entry says every Request here is an HTTP one.
    for (const url of ["file:///etc/passwd", "ftp://example.com", "data:text/plain,hi"]) {
      expect(normaliseBaseURL(url).ok, url).toBe(false);
    }
  });

  it("refuses a URL carrying a username and password", () => {
    // Those characters would end up in a Credential and in every failure
    // message this app renders, which is the wrong place for a secret.
    const outcome = normaliseBaseURL("http://user:hunter2@localhost:8000/v1");

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toContain("Credential");
  });

  it("says what a base URL is when it is not one", () => {
    const outcome = normaliseBaseURL("localhost:8000");

    expect(outcome.ok).toBe(false);
    // Naming the shape is the difference between a fixable message and a puzzle.
    if (!outcome.ok) expect(outcome.error).toContain("http://localhost:11434/v1");
  });

  it("refuses an empty one", () => {
    expect(normaliseBaseURL("   ").ok).toBe(false);
  });
});

describe("an Endpoint's id", () => {
  it("is a slug a reader could type, rather than something opaque", () => {
    // The id is shown in the picker, kept in storage, and used to derive the
    // variable a Credential goes under. All three are read by a person.
    expect(slugFor("My Home Server")).toBe("my-home-server");
    expect(slugFor("vLLM (GPU box)")).toBe("vllm-gpu-box");
  });

  it("names the Credential's variable after the Endpoint, namespaced so it cannot collide", () => {
    // The failure the spec records having already had once: eight Catalog
    // entries shared one variable name and a single typed key was proxied to
    // several hosts. A derived name that could collide could do that again.
    const name = credentialVarFor("my-server");

    expect(name).toBe("CUSTOM_MY_SERVER_API_KEY");
    expect(RESERVED_ENDPOINT_IDS.has("my-server")).toBe(false);
    expect(credentialVarFor("ollama")).not.toBe(credentialVarFor("openai"));
  });
});

describe("declaring an Endpoint", () => {
  it("writes it where the reader can find it, with the Models they gave", async () => {
    const outcome = await declare({ models: ["qwen3-coder", "llama3.2"] });

    expect(outcome.ok).toBe(true);
    const written = JSON.parse(await readFileText());
    expect(written.endpoints).toEqual([
      {
        id: "my-server",
        name: "My server",
        baseURL: "http://localhost:8000/v1",
        defaultModelId: "qwen3-coder",
        knownModels: ["qwen3-coder", "llama3.2"],
        declared: true,
      },
    ]);
  });

  it("uses the first Model as the default, keeping the order the reader gave", async () => {
    // Re-ordering them would quietly change which Model is in use.
    await declare({ models: ["first", "second"] });

    const [written] = (await readDeclaredEndpoints(project.dir, NOTHING_RESERVED)).endpoints;
    expect(written.defaultModelId).toBe("first");
    expect(written.knownModels).toEqual(["first", "second"]);
  });

  it("needs no Credential and Configures immediately when none is given", async () => {
    // The ordinary case for a server on the reader's own machine. An Endpoint
    // that needed a key to be usable would make the common path the broken one.
    const outcome = await declare();

    expect(outcome.ok && outcome.credential).toEqual({
      written: false,
      envVar: null,
      reason: "notNeeded",
    });
    expect(await readEnvFile()).toBe("");
  });

  it("writes a Credential to the environment file, never to .endpoints.json", async () => {
    const secret = "sk-a-custom-key";
    const outcome = await declare({ credential: secret });

    expect(outcome.ok && outcome.credential.written).toBe(true);
    expect(await readEnvFile()).toContain(`${credentialVarFor("my-server")}=${secret}`);

    // The file is the thing a developer might read, share, or commit. It must
    // hold an address and a name and nothing that authenticates.
    expect(await readFileText()).not.toContain(secret);
  });

  it("refuses a Credential that could not survive the environment file, writing nothing", async () => {
    // A Credential that is stored and looks stored, and then fails at the
    // Endpoint with nothing to connect it to what was typed, is worse than one
    // that was never saved.
    const outcome = await declare({ credential: 'sk-with-a"quote' });

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toContain("Nothing was written");
    await expect(readFileText()).rejects.toThrow();
  });

  it("refuses an id the Registry already holds, so the Catalog cannot be shadowed", async () => {
    // Shadowing would be the quiet version of the shared-variable failure: an
    // entry answering to an id a Catalog Endpoint also answers to.
    const outcome = await declare({ name: "Ollama", reserved: RESERVED_ENDPOINT_IDS });

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toContain("already");
    await expect(readFileText()).rejects.toThrow();
  });

  it("needs at least one Model, since an Endpoint that cannot be asked still needs a start", async () => {
    const outcome = await declare({ models: [] });

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toContain("at least one Model");
  });

  it("adds rather than replaces when the id is new", async () => {
    await declare({ name: "First server" });
    await declare({ name: "Second server" });

    const { endpoints } = await readDeclaredEndpoints(project.dir, NOTHING_RESERVED);
    expect(endpoints.map((endpoint) => endpoint.id)).toEqual(["first-server", "second-server"]);
  });

  it("replaces in place when the name is the same, so a Credential can be added later", async () => {
    // The case a reader meets having added a server first and only later found
    // out what key it wants. Replacing keeps the Endpoint where they left it in
    // the list rather than sending it to the end for an edit of a key.
    await declare({ name: "My server" });
    await declare({ name: "Second server" });
    await declare({ credential: "sk-added-later" });

    const { endpoints } = await readDeclaredEndpoints(project.dir, NOTHING_RESERVED);
    // Still two Endpoints, still in the order they were added — the edit did not
    // append a third, and did not send the edited one to the end.
    expect(endpoints.map((endpoint) => endpoint.id)).toEqual(["my-server", "second-server"]);
    expect(endpoints[0].credentialEnvVar).toBe("CUSTOM_MY_SERVER_API_KEY");
  });

  it("refuses two different names that would answer to one id", async () => {
    await declare({ name: "My server" });
    const outcome = await declare({ name: "My  server!" });

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toContain("different name");
  });

  it("leaves an interrupted write with the previous file intact", async () => {
    await declare({ name: "First server" });
    const before = await readFileText();

    // The interruption atomic writing exists to survive: a reader who loses
    // every Endpoint they declared to a failed save has no way to get them back.
    await expect(
      declare({
        name: "Second server",
        reserved: NOTHING_RESERVED,
        writeTempFile: async () => {
          throw new Error("interrupted");
        },
      }),
    ).rejects.toThrow();

    expect(await readFileText()).toBe(before);
  });
});

describe("reading the file back", () => {
  it("is empty and untroubled on a machine that has declared nothing", async () => {
    // The ordinary case, and the one that must not be reported as a problem.
    const read = await readDeclaredEndpoints(project.dir, NOTHING_RESERVED);

    expect(read).toEqual({ endpoints: [], malformed: false });
  });

  it("says the file could not be understood rather than reading as none", async () => {
    // A reader who declared three Endpoints and can see none has lost them, and
    // needs to know the file is why rather than believing they misremembered.
    await writeFile(project.endpointsFile(), "{ not json", "utf8");

    expect(await readDeclaredEndpoints(project.dir, NOTHING_RESERVED)).toEqual({
      endpoints: [],
      malformed: true,
    });
  });

  it("refuses a file that is JSON but not the shape this app writes", async () => {
    for (const contents of ['{"endpoints": {}}', '{"endpoints": [{}]}', "[]", '"a string"']) {
      await writeFile(project.endpointsFile(), contents, "utf8");
      const read = await readDeclaredEndpoints(project.dir, NOTHING_RESERVED);
      expect(read.malformed, contents).toBe(true);
    }
  });

  it("drops an id the Registry holds, rather than letting a file shadow the Catalog", async () => {
    await writeFile(
      project.endpointsFile(),
      JSON.stringify({
        endpoints: [
          {
            id: "ollama",
            name: "Not Ollama",
            baseURL: "http://attacker.example/v1",
            defaultModelId: "evil",
            knownModels: ["evil"],
            declared: true,
          },
        ],
      }),
      "utf8",
    );

    // The Registry's own Ollama is in source and reviewed; this one is in a file
    // anyone can edit. The reader asking for a private server should not be able
    // to change where a Catalog Credential goes by writing a line of JSON.
    const read = await readDeclaredEndpoints(project.dir, RESERVED_ENDPOINT_IDS);
    expect(read.endpoints).toEqual([]);
    expect(read.malformed).toBe(false);
  });

  it("refuses an address it would not have accepted through the interface", async () => {
    // The file is the one input to this app that is not reviewed as code, so the
    // checks that guard the dialog's own writes have to hold for a hand-edited
    // one too. Otherwise `file:///...` reaches resolveEndpoint having passed
    // nothing at all.
    const entry = (baseURL: string) => ({
      id: "hand-written",
      name: "Hand written",
      baseURL,
      defaultModelId: "a",
      knownModels: ["a"],
      declared: true,
    });

    for (const baseURL of [
      "file:///etc/passwd",
      "ftp://example.com",
      "http://user:hunter2@localhost:8000/v1",
      "localhost:8000",
    ]) {
      await writeFile(project.endpointsFile(), JSON.stringify({ endpoints: [entry(baseURL)] }), "utf8");

      const read = await readDeclaredEndpoints(project.dir, NOTHING_RESERVED);
      expect(read.endpoints, baseURL).toEqual([]);
      expect(read.malformed, baseURL).toBe(true);
    }
  });

  it("refuses a Credential variable this app would never have derived", async () => {
    // It names where a Credential is read from, and one from a hand-edited file
    // is an address for a variable belonging to something else entirely.
    await writeFile(
      project.endpointsFile(),
      JSON.stringify({
        endpoints: [
          {
            id: "hand-written",
            name: "Hand written",
            baseURL: "http://localhost:8000/v1",
            defaultModelId: "a",
            knownModels: ["a"],
            credentialEnvVar: "OPENAI_API_KEY",
            declared: true,
          },
        ],
      }),
      "utf8",
    );

    const read = await readDeclaredEndpoints(project.dir, NOTHING_RESERVED);
    expect(read.endpoints).toEqual([]);
    expect(read.malformed).toBe(true);
  });

  it("keeps the first of two entries sharing an id", async () => {    // Which one is in use must not be left to object key order.
    await writeFile(
      project.endpointsFile(),
      JSON.stringify({
        endpoints: [
          { id: "dup", name: "First", baseURL: "http://a.example/v1", defaultModelId: "a", knownModels: ["a"], declared: true },
          { id: "dup", name: "Second", baseURL: "http://b.example/v1", defaultModelId: "b", knownModels: ["b"], declared: true },
        ],
      }),
      "utf8",
    );

    const { endpoints } = await readDeclaredEndpoints(project.dir, NOTHING_RESERVED);
    expect(endpoints.map((endpoint) => endpoint.name)).toEqual(["First"]);
  });
});

describe("forgetting an Endpoint", () => {
  it("takes the Endpoint and its Credential off together", async () => {
    // Leaving the second would be a secret left in .env.local naming a server
    // that is no longer configured.
    await declare({ credential: "sk-to-be-removed" });
    await forgetEndpoint({ dir: project.dir, id: "my-server", reserved: NOTHING_RESERVED });

    expect((await readDeclaredEndpoints(project.dir, NOTHING_RESERVED)).endpoints).toEqual([]);
    expect(await readEnvFile()).not.toContain("sk-to-be-removed");
  });

  it("leaves other Endpoints and other Credentials alone", async () => {
    await declare({ name: "Keep me", credential: "sk-kept" });
    await declare({ name: "Remove me", credential: "sk-removed" });

    await forgetEndpoint({ dir: project.dir, id: "remove-me", reserved: NOTHING_RESERVED });

    const { endpoints } = await readDeclaredEndpoints(project.dir, NOTHING_RESERVED);
    expect(endpoints.map((endpoint) => endpoint.id)).toEqual(["keep-me"]);

    const env = await readEnvFile();
    expect(env).toContain("sk-kept");
    expect(env).not.toContain("sk-removed");
  });

  it("does nothing for an id that is not there", async () => {
    // The reader's Endpoint is gone either way; an error would be about a file
    // they can no longer see.
    await declare();
    await forgetEndpoint({ dir: project.dir, id: "never-declared", reserved: NOTHING_RESERVED });

    expect((await readDeclaredEndpoints(project.dir, NOTHING_RESERVED)).endpoints).toHaveLength(1);
  });

  it("leaves an interrupted removal with the Endpoint still there", async () => {
    await declare({ name: "Survivor" });

    await expect(
      forgetEndpoint({
        dir: project.dir,
        id: "survivor",
        reserved: NOTHING_RESERVED,
        writeTempFile: async () => {
          throw new Error("interrupted");
        },
      }),
    ).rejects.toThrow();

    const { endpoints } = await readDeclaredEndpoints(project.dir, NOTHING_RESERVED);
    expect(endpoints.map((endpoint) => endpoint.id)).toEqual(["survivor"]);
  });
});

describe("the file this app writes", () => {
  it("is the one declared at the top of this module, and is not an environment file", async () => {
    // Named `.endpoints.json` beside `.reading-root.json`, and never `.env*`:
    // a name Next watches would fire its own reload in the middle of the write.
    expect(ENDPOINTS_FILE).toBe(".endpoints.json");
    await declare();
    await expect(readFileText()).resolves.toContain('"endpoints"');
  });
});

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { declareEndpoint } from "./custom";
import { RESERVED_ENDPOINT_IDS } from "./registry";
import { resolveEndpointById } from "./resolve";
import { describeEndpoints } from "./status";
import {
  temporaryProject,
  type TemporaryProject,
} from "@/lib/testing/temporary-project";

/**
 * Where the two halves of the Registry meet.
 *
 * The Registry used to be one list, all of it in source. It is now the Catalog
 * and the declared Local Endpoints in source, plus whatever the reader has
 * declared in `.endpoints.json` — and these are the properties that has to keep
 * once the second half is no longer a constant.
 */

const project: TemporaryProject = await temporaryProject("registry-merge-");
const { begin, end } = project;

beforeEach(async () => {
  await begin();
});

afterEach(end);

function declare(name: string, credential?: string) {
  return declareEndpoint({
    dir: project.dir,
    name,
    baseURL: "http://localhost:8000/v1",
    models: ["qwen3-coder"],
    reserved: RESERVED_ENDPOINT_IDS,
    ...(credential !== undefined ? { credential } : {}),
  });
}

describe("the Registry as a whole", () => {
  it("offers the Catalog Endpoints whether or not a file exists", async () => {
    const { statuses } = await describeEndpoints({}, project.dir);

    // The ordinary case has to be untouched: a reader who has declared nothing
    // should not see a different app.
    expect(statuses.some((status) => status.id === "openrouter")).toBe(true);
    expect(statuses.some((status) => status.id === "ollama")).toBe(true);
  });

  it("includes an Endpoint the reader declared, grouped as their own", async () => {
    await declare("My server");

    const { statuses } = await describeEndpoints({}, project.dir);
    const mine = statuses.find((status) => status.id === "my-server");

    expect(mine?.name).toBe("My server");
    expect(mine?.group).toBe("declared");
    expect(mine?.defaultModelId).toBe("qwen3-coder");
  });

  it("keeps listing the Catalog when the reader's file cannot be read", async () => {
    // A corrupt file should cost the reader the Endpoints they added, not the
    // hundred and eighty-nine they did not.
    await declare("My server");
    await (await import("node:fs/promises")).writeFile(
      project.endpointsFile(),
      "{ not json",
      "utf8",
    );

    const { statuses, declaredTrouble } = await describeEndpoints({}, project.dir);

    expect(statuses.length).toBeGreaterThan(100);
    expect(statuses.some((status) => status.id === "openrouter")).toBe(true);
    expect(declaredTrouble).toContain(".endpoints.json");
  });
});

describe("resolving an Endpoint a Request named", () => {
  it("finds one from the source Registry, as it always did", async () => {
    const found = await resolveEndpointById("ollama", project.dir, {});

    expect(found?.endpoint.baseURL).toBe("http://localhost:11434/v1");
    expect(found?.resolution.ok).toBe(true);
  });

  it("finds one the reader declared, which is the half that lives in a file", async () => {
    await declare("My server");

    const found = await resolveEndpointById("my-server", project.dir, {});

    expect(found?.endpoint.name).toBe("My server");
    // A server on the reader's own machine needs no Credential, so it resolves
    // and is usable the moment it is written.
    expect(found?.resolution).toEqual({
      ok: true,
      baseURL: "http://localhost:8000/v1",
      credential: undefined,
    });
  });

  it("reports a declared Endpoint's missing Credential by the variable it belongs in", async () => {
    await declare("My server", "sk-a-key");
    delete process.env.CUSTOM_MY_SERVER_API_KEY;

    const found = await resolveEndpointById("my-server", project.dir, process.env);

    // Naming the variable is what makes the fix obvious without reading source,
    // which is the same answer the Catalog's Endpoints give.
    expect(found?.resolution.ok).toBe(false);
    if (found && !found.resolution.ok) {
      expect(found.resolution.missingEnvVar).toBe("CUSTOM_MY_SERVER_API_KEY");
    }
  });

  it("returns nothing for an id that names no Endpoint at all", async () => {
    expect(await resolveEndpointById("not-an-endpoint", project.dir, {})).toBeUndefined();
  });

  it("prefers the source Registry over a file claiming the same id", async () => {
    // Even though `readDeclaredEndpoints` drops such an entry, the lookup is
    // asked for one id and must answer with the reviewed Endpoint — a request
    // naming `ollama` must not be proxied somewhere a file chose.
    await (await import("node:fs/promises")).writeFile(
      project.endpointsFile(),
      JSON.stringify({
        endpoints: [
          {
            id: "ollama",
            name: "Not Ollama",
            baseURL: "http://elsewhere.example/v1",
            defaultModelId: "evil",
            knownModels: ["evil"],
            declared: true,
          },
        ],
      }),
      "utf8",
    );

    const found = await resolveEndpointById("ollama", project.dir, {});

    expect(found?.endpoint.baseURL).toBe("http://localhost:11434/v1");
  });
});

describe("the ids the reader may declare", () => {
  it("excludes every id the source Registry holds", () => {
    expect(RESERVED_ENDPOINT_IDS.has("ollama")).toBe(true);
    expect(RESERVED_ENDPOINT_IDS.has("openai")).toBe(true);
    expect(RESERVED_ENDPOINT_IDS.has("my-server")).toBe(false);
  });
});

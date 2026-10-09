import { describe, expect, it } from "vitest";

import type { CatalogEntry } from "./types";
import { validateCatalog } from "./validate";

/**
 * The Catalog is trusted input that decides where a Credential is sent, so a
 * malformed entry is a defect worth failing on now rather than discovering at
 * request time — when the failure looks like a provider outage.
 *
 * Each case here is a way the Catalog could send a Credential somewhere wrong,
 * point at nothing, or shadow another Endpoint.
 */

const goodEntry: CatalogEntry = {
  id: "example",
  name: "Example",
  baseURL: "https://api.example.com/v1",
  credentialEnvVar: "EXAMPLE_API_KEY",
  doc: "https://example.com/models",
  capabilities: ["toolCalling"],
  knownModels: ["example-1"],
};

/** A valid Catalog with one field changed, so a test states only what it means. */
function catalogWith(overrides: Partial<CatalogEntry> = {}): readonly CatalogEntry[] {
  return [{ ...goodEntry, ...overrides }];
}

/** What the failure says, which is the part a reader has to act on. */
function complaintAbout(entries: readonly CatalogEntry[]): string {
  try {
    validateCatalog(entries);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("validateCatalog accepted a Catalog it should have refused");
}

describe("the Catalog as trusted input", () => {
  it("accepts an entry carrying a base URL and a Credential variable", () => {
    expect(() => validateCatalog(catalogWith())).not.toThrow();
  });

  it("refuses an entry with no base URL, rather than Proxying nowhere", () => {
    const complaint = complaintAbout(catalogWith({ baseURL: "" }));

    expect(complaint).toContain("example");
    expect(complaint).toContain("base URL");
  });

  it("refuses an entry whose base URL is only whitespace", () => {
    expect(complaintAbout(catalogWith({ baseURL: "   " }))).toContain("base URL");
  });

  it("refuses an entry with no environment variable to read its Credential from", () => {
    const complaint = complaintAbout(catalogWith({ credentialEnvVar: "" }));

    expect(complaint).toContain("example");
    expect(complaint).toContain("environment variable");
  });

  it("refuses a base URL that is a template still awaiting an account id", () => {
    // models.dev carries a few of these. Completing one by guess would mean
    // guessing where a Credential is sent, so they must not survive review.
    const complaint = complaintAbout(
      catalogWith({ baseURL: "https://api.example.com/accounts/${ACCOUNT_ID}/v1" }),
    );

    expect(complaint).toContain("base URL");
  });

  it("refuses two entries sharing an id, since the second would be unreachable", () => {
    const complaint = complaintAbout([
      goodEntry,
      { ...goodEntry, name: "Example Two", baseURL: "https://api.example.com/v2" },
    ]);

    expect(complaint).toContain("example");
    expect(complaint).toContain("twice");
  });

  it("refuses an entry with no id to look it up by", () => {
    expect(complaintAbout(catalogWith({ id: "" }))).toContain("id");
  });

  it("refuses an entry with no name, since it would be unreadable in the list", () => {
    expect(complaintAbout(catalogWith({ name: "  " }))).toContain("name");
  });

  it("refuses an empty Catalog, which would leave the app offering nothing", () => {
    expect(complaintAbout([])).toContain("empty");
  });

  it("refuses one Credential variable reaching two hosts, which would send it somewhere unchosen", () => {
    // Two regional services behind one variable name: a reader who enters it
    // configures both, and the value is proxied to two different companies'
    // servers. The Catalog decides where a Credential goes, so this has to fail
    // here rather than be discovered by watching a key cross a border.
    const complaint = complaintAbout([
      goodEntry,
      {
        ...goodEntry,
        id: "example-cn",
        name: "Example China",
        baseURL: "https://api.example.cn/v1",
      },
    ]);

    expect(complaint).toContain("EXAMPLE_API_KEY");
    expect(complaint).toContain("example-cn");
    expect(complaint).toMatch(/host/i);
  });

  it("names every Entry sharing a variable across hosts, so one review fixes them all", () => {
    const complaint = complaintAbout([
      goodEntry,
      { ...goodEntry, id: "example-cn", name: "CN", baseURL: "https://api.example.cn/v1" },
      { ...goodEntry, id: "example-eu", name: "EU", baseURL: "https://api.example.eu/v1" },
    ]);

    expect(complaint).toContain("example");
    expect(complaint).toContain("example-cn");
    expect(complaint).toContain("example-eu");
  });

  it("accepts two Entries sharing a variable at one host, since that is one Credential", () => {
    // Two catalogue entries for the same service at the same address are the
    // same Credential listed twice, not a value sent to two places.
    expect(() =>
      validateCatalog([
        goodEntry,
        { ...goodEntry, id: "example-plans", name: "Example Plans", baseURL: `${goodEntry.baseURL}/v1` },
      ]),
    ).not.toThrow();
  });

  it("names every offending entry at once, so one review fixes the whole file", () => {
    const complaint = complaintAbout([
      { ...goodEntry, id: "first", baseURL: "" },
      { ...goodEntry, id: "second", credentialEnvVar: "" },
    ]);

    expect(complaint).toContain("first");
    expect(complaint).toContain("second");
  });
});
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * What happens when the recommended list names an Endpoint the Catalog does not
 * hold.
 *
 * A typo there would otherwise do nothing at all: the id matches nothing, the
 * provider appears under "Cloud (Others)" like any other, and the list looks
 * like it simply recommends nothing. That is a silent wrong answer about which
 * providers this app thinks are worth reaching for, so the Registry refuses to
 * load instead.
 *
 * These reach for a failure at module load, which needs the Catalog replaced
 * before the Registry is imported — hence its own file, so the mock does not
 * leak into the tests that want the real Catalog.
 */

/** The names the real Registry recommends, read before anything is mocked. */
const RECOMMENDED = [...(await import("./registry")).RECOMMENDED_CLOUD_IDS];

afterEach(() => {
  vi.resetModules();
  vi.doUnmock("./validate");
});

/** Imports the Registry against a Catalog holding exactly these ids. */
async function importingWithCatalog(ids: readonly string[]) {
  vi.doMock("./validate", () => ({
    CLOUD_ENDPOINTS: ids.map((id) => ({ id })),
    VALIDATED_CATALOG: ids.map((id) => ({ id })),
  }));

  return import("./registry");
}

describe("a recommended name the Catalog does not hold", () => {
  it("loads when every recommended name is present", async () => {
    const registry = await importingWithCatalog([...RECOMMENDED, "some-other-provider"]);

    expect(registry.RECOMMENDED_CLOUD_IDS.has("openai")).toBe(true);
  });

  it("refuses to load when one recommended name is missing from the Catalog", async () => {
    const absent = RECOMMENDED[0];
    const partial = RECOMMENDED.filter((id) => id !== absent);

    // The whole point: a name nothing matches would otherwise demote its
    // provider into "Cloud (Others)" with nothing saying a list had gone stale.
    await expect(importingWithCatalog(partial)).rejects.toThrow(new RegExp(absent));
  });

  it("names the Catalog as the thing to check, not just the unmatched name", async () => {
    // A reader who fixed the wrong half — editing the Catalog rather than the
    // typo — would end up here again, so the message has to say which half.
    const partial = RECOMMENDED.slice(1);

    await expect(importingWithCatalog(partial)).rejects.toThrow(/Catalog/);
  });
});
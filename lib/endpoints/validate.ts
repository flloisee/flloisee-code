import { CATALOG } from "./catalog";
import type { CatalogEntry } from "./types";

/**
 * The Catalog is trusted input, and it decides where a Credential is sent. That
 * makes it the one piece of configuration whose defects are worth failing on
 * loudly at startup: a malformed entry otherwise surfaces as an obscure request
 * failure much later, long after the mistake was committed.
 *
 * The checks are deliberately cheap and structural. Anything that needs a
 * judgement call belongs in review of the diff, not in code that runs on every
 * start.
 */

/** Where the Catalog came from, and when. Recorded so two snapshots can be
 *  compared rather than one trusted over the other. */
export const CATALOG_ORIGIN = {
  source: "https://models.dev/api.json",
  snapshotDate: "2026-10-09",
  cloudEndpoints: CATALOG.length,
};

/**
 * Checks a Catalog and returns it narrowed, or throws naming every entry at
 * fault.
 *
 * Reports all problems together rather than the first: a Catalog is edited as a
 * file, so fixing one defect per run would be a poor way to review it.
 */
export function validateCatalog(entries: readonly CatalogEntry[]): readonly CatalogEntry[] {
  const faults: string[] = [];

  if (entries.length === 0) {
    throw new Error(
      "The Catalog is empty, so the app would offer no Cloud Endpoints at all. " +
        "Regenerate it with `node scripts/refresh-catalog.mjs <models.dev-api.json>`.",
    );
  }

  const seen = new Map<string, number>();

  entries.forEach((entry, position) => {
    const id = describe(entry?.id) || `the entry at position ${position}`;

    if (!describe(entry?.id)) faults.push(`${id}: has no id, so it cannot be looked up.`);
    if (!describe(entry?.name)) faults.push(`${id}: has no name, so it would be unreadable.`);

    const baseURL = describe(entry?.baseURL);
    if (!baseURL) {
      faults.push(`${id}: has no base URL, so requests would be proxied nowhere.`);
    } else if (baseURL.includes("${")) {
      // models.dev publishes a few of these. They are templates awaiting an
      // account-specific value, and completing one here would mean deciding
      // where a Credential goes without anything to check it against.
      faults.push(
        `${id}: base URL ${baseURL} is an unsubstituted template, not an address. ` +
          "Complete it with your own account id, or leave the Endpoint out.",
      );
    }

    if (!describe(entry?.credentialEnvVar)) {
      faults.push(`${id}: has no environment variable name, so its Credential can never be read.`);
    }

    if (!describe(entry?.doc)) {
      faults.push(`${id}: has no documentation link, so setup cannot be checked without source.`);
    }

    if (!Array.isArray(entry?.knownModels) || entry.knownModels.length === 0) {
      faults.push(`${id}: lists no known Models, so there is nothing to start a Conversation with.`);
    }

    const firstSeenAt = seen.get(entry?.id ?? "");
    if (firstSeenAt !== undefined) {
      faults.push(
        `${id}: appears twice, at positions ${firstSeenAt} and ${position}. ` +
          "The second would be unreachable, since an Endpoint is found by id.",
      );
    } else {
      seen.set(entry?.id ?? "", position);
    }
  });

  if (faults.length > 0) {
    throw new Error(
      `The Catalog is malformed — it decides which address a Credential is sent to, ` +
        `so it is checked before use. Fix these:\n  - ${faults.join("\n  - ")}`,
    );
  }

  return entries;
}

/**
 * The validated Catalog.
 *
 * Validation runs at module load, so a malformed Catalog stops the app rather
 * than waiting to be discovered at request time. The exported value is
 * `readonly` because nothing downstream has a reason to change where a
 * Credential goes.
 */
export const VALIDATED_CATALOG = validateCatalog(CATALOG);

/**
 * The Cloud Endpoints the Catalog offers, each with a starting Model.
 *
 * The starting Model is the first known one, and only a starting point: Model
 * Discovery asks the Endpoint which Models it currently offers, so this is
 * replaced the moment the Endpoint answers.
 */
export const CLOUD_ENDPOINTS = VALIDATED_CATALOG.map(
  (entry): CatalogEntry & { defaultModelId: string } => ({
    ...entry,
    defaultModelId: entry.knownModels[0],
  }),
);

/** A Catalog entry's text, or undefined when it is absent or only whitespace. */
function describe(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}
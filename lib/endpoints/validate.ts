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

  faults.push(...faultsForSharedCredentialVars(entries));

  if (faults.length > 0) {
    throw new Error(
      `The Catalog is malformed — it decides which address a Credential is sent to, ` +
        `so it is checked before use. Fix these:\n  - ${faults.join("\n  - ")}`,
    );
  }

  return entries;
}

/**
 * One variable name reaching more than one host.
 *
 * The Catalog decides where a Credential is sent, and this is the one way the
 * decision escapes the review of the individual entry. One variable read by two
 * Endpoints on two hosts means one value entered through the interface is
 * Configured into two Endpoints and proxied to two different companies'
 * servers — so a reader who picked one Endpoint has their Credential sent to
 * another they never chose. models.dev reports this for the regional pairs that
 * each publish their own account (Z.AI against Zhipu AI, Moonshot against
 * Moonshot China, and so on), conflating services that have separate accounts
 * behind a shared name. See the header of catalog.ts for the correction.
 *
 * Two Entries at the SAME host are not this fault: that is one service and one
 * Credential listed under two names, and sharing is honest.
 *
 * Checked at module load with the rest of the Catalog, because a Credential
 * fanning out is worse than a malformed entry — it looks like it works.
 */
function faultsForSharedCredentialVars(entries: readonly CatalogEntry[]): string[] {
  const hostsByVar = new Map<string, Map<string, CatalogEntry[]>>();

  for (const entry of entries) {
    const name = describe(entry?.credentialEnvVar);
    const host = hostOf(entry?.baseURL);
    if (name === undefined || host === undefined) continue;

    const byHost = hostsByVar.get(name) ?? new Map<string, CatalogEntry[]>();
    byHost.set(host, [...(byHost.get(host) ?? []), entry]);
    hostsByVar.set(name, byHost);
  }

  const faults: string[] = [];

  for (const [name, byHost] of hostsByVar) {
    if (byHost.size < 2) continue;

    const perHost = [...byHost].map(([host, at]) => `${host} (${at.map((e) => e.id).join(", ")})`);
    faults.push(
      `${name}: one Credential variable reaches ${byHost.size} hosts — ${perHost.join("; ")}. ` +
        `Entering it would configure every one of those Endpoints and send the value to each of ` +
        `those servers, which is not an address any reader chose. Give each service its own ` +
        `variable name, or drop the entries that do not need one.`,
    );
  }

  return faults;
}

/** An address's host, or undefined when it is not an address at all. */
function hostOf(baseURL: unknown): string | undefined {
  const text = describe(baseURL);
  if (text === undefined) return undefined;

  try {
    return new URL(text).host;
  } catch {
    return undefined;
  }
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
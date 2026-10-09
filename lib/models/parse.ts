/**
 * Reading Model identifiers off whatever an Endpoint's models listing
 * contains.
 *
 * The SDK exposes no listing operation, so discovery is a plain fetch and this
 * is where its response becomes identifiers. Endpoints differ in shape: the
 * OpenAI-compatible servers answer `{"object":"list","data":[{"id":...}]}`,
 * while Ollama's native tags path answers `{"models":[{"name":...}]}`.
 */

/** Where a listing may carry its identifiers, in the order we look for them. */
const LISTING_KEYS = ["data", "models"] as const;

/** The keys an entry may name its identifier by. */
const IDENTIFIER_KEYS = ["id", "name"] as const;

export function parseModelIdentifiers(listing: unknown): string[] {
  const entries = readEntries(listing);

  const identifiers = new Set<string>();

  for (const entry of entries) {
    const identifier = readIdentifier(entry);
    if (identifier !== undefined) identifiers.add(identifier);
  }

  // The Endpoint's own order is preserved, so no opinion of ours is imposed on
  // a list we did not produce.
  return [...identifiers];
}

/** Finds the array of entries inside a listing, whether or not it has one. */
function readEntries(listing: unknown): unknown[] {
  if (Array.isArray(listing)) return listing;

  if (typeof listing !== "object" || listing === null) return [];

  const record = listing as Record<string, unknown>;

  for (const key of LISTING_KEYS) {
    if (Array.isArray(record[key])) return record[key];
  }

  return [];
}

function readIdentifier(entry: unknown): string | undefined {
  if (typeof entry === "string") return trimmed(entry);

  if (typeof entry !== "object" || entry === null) return undefined;

  const record = entry as Record<string, unknown>;

  for (const key of IDENTIFIER_KEYS) {
    const value = record[key];
    if (typeof value !== "string") continue;

    const identifier = trimmed(value);
    if (identifier !== undefined) return identifier;
  }

  return undefined;
}

function trimmed(value: string): string | undefined {
  const identifier = value.trim();
  return identifier.length > 0 ? identifier : undefined;
}
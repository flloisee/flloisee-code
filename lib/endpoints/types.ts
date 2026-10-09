/**
 * The vocabulary an Endpoint is described in.
 *
 * A Local Endpoint is declared by hand; a Cloud Endpoint comes from the Catalog.
 * They are the same thing to everything downstream, which is why both are one
 * type here — the difference that matters to the rest of the app is whether a
 * Credential is needed, and that is read off `credentialEnvVar`.
 */

/**
 * A Local Endpoint — an AI Endpoint served from the machine running the app.
 *
 * It requires no Credential, so it is usable the moment its server is running.
 */
export type LocalEndpoint = {
  id: string;
  name: string;
  baseURL: string;
  /** The Model chosen for this Endpoint until the user picks another. */
  defaultModelId: string;
  /** Present on Cloud Endpoints only; a Local Endpoint needs no Credential. */
  credentialEnvVar?: string;
};

/**
 * One Cloud Endpoint as the Catalog records it.
 *
 * This is the shape committed to source control, not the shape the app uses at
 * runtime: it is checked by validateCatalog before anything acts on it.
 */
export type CatalogEntry = {
  id: string;
  name: string;
  /** Where requests are proxied. Decides the destination of a Credential. */
  baseURL: string;
  /** The environment variable holding this Endpoint's Credential. */
  credentialEnvVar: string;
  /** Where the Endpoint documents itself, so a reader need not read source. */
  doc: string;
  /** What at least one of this Endpoint's Models can do. */
  capabilities: readonly string[];
  /** Model identifiers known at snapshot time; a starting point, not the list. */
  knownModels: readonly string[];
  /**
   * Set on entries whose base URL was written by hand rather than taken from
   * models.dev, so a reviewer can tell the two apart in a diff.
   */
  handAdded?: boolean;
};

/**
 * A Cloud Endpoint as the app uses it.
 *
 * Same fields as its CatalogEntry, plus the starting Model. Narrowed from the
 * validated Catalog rather than written separately, so the two cannot drift.
 */
export type CloudEndpoint = CatalogEntry & {
  /** The Model to use until the user picks another. */
  defaultModelId: string;
};

/** Either kind of Endpoint. The Registry holds both. */
export type Endpoint = LocalEndpoint | CloudEndpoint;
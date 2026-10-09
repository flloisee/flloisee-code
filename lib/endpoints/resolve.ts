import { readDeclaredEndpoints } from "./custom";
import { findEndpoint, RESERVED_ENDPOINT_IDS } from "./registry";
import type { Endpoint } from "./types";

/** The environment a Credential is read from. Injected so it can be varied in tests. */
export type Environment = Record<string, string | undefined>;

export type ResolvedEndpoint = {
  ok: true;
  baseURL: string;
  /** Absent for a Local Endpoint, which requires no Credential. */
  credential: string | undefined;
};

export type UnresolvedEndpoint = {
  ok: false;
  /** Names the environment variable to set, so setup is obvious without reading source. */
  missingEnvVar: string;
};

export type EndpointResolution = ResolvedEndpoint | UnresolvedEndpoint;

/**
 * Turns a declared Endpoint into the base URL and Credential a Request needs.
 *
 * A Local Endpoint resolves without a Credential and is therefore always
 * Configured. A Cloud Endpoint whose Credential is absent is reported as
 * unconfigured rather than surfacing later as an obscure request failure. The
 * same holds for a declared Endpoint, which resolves without one when the reader
 * declared it without a Credential.
 *
 * The base URL comes from the Endpoint alone — never from a request. For a
 * Catalog Endpoint that is the guardrail that stops a caller who reached this
 * app choosing where a Credential lands, and it is unchanged: those addresses
 * are in source and no route writes to them. For a declared Endpoint the
 * Endpoint is read from `.endpoints.json`, which only a development-only route
 * writes, so the address still arrives from the server rather than from whoever
 * made the Request. See `lib/endpoints/custom.ts` for the full argument.
 */
export function resolveEndpoint(endpoint: Endpoint, env: Environment): EndpointResolution {
  const { credentialEnvVar } = endpoint;

  if (credentialEnvVar === undefined) {
    return { ok: true, baseURL: endpoint.baseURL, credential: undefined };
  }

  const credential = env[credentialEnvVar];

  if (!credential) {
    return { ok: false, missingEnvVar: credentialEnvVar };
  }

  return { ok: true, baseURL: endpoint.baseURL, credential };
}

/**
 * The Endpoint a Request named, from either source.
 *
 * The one place both halves of the Registry meet. Source-controlled Endpoints are
 * found first, and a declared Endpoint can never hold an id that a source one
 * does — `readDeclaredEndpoints` drops any that does — so the order is not a
 * precedence rule so much as the cheap case being cheap. Every route that
 * resolves an Endpoint id from a Request goes through here rather than
 * `findEndpoint`, which cannot see the file.
 */
export async function resolveEndpointById(
  id: string,
  dir: string,
  env: Environment,
): Promise<{ endpoint: Endpoint; resolution: EndpointResolution } | undefined> {
  const inSource = findEndpoint(id);
  if (inSource !== undefined) return { endpoint: inSource, resolution: resolveEndpoint(inSource, env) };

  const declared = await readDeclaredEndpoints(dir, RESERVED_ENDPOINT_IDS);
  const found = declared.endpoints.find((endpoint) => endpoint.id === id);
  if (found === undefined) return undefined;

  return { endpoint: found, resolution: resolveEndpoint(found, env) };
}
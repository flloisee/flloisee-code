import type { Endpoint } from "./types";

/** The environment a Credential is read from. Injected so it can be varied in tests. */
export type Environment = Record<string, string | undefined>;

export type ResolvedEndpoint = {
  ok: true;
  baseURL: string;
  /** Absent for a Local Endpoint, which requires no Credential. */
  apiKey: string | undefined;
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
 * unconfigured rather than surfacing later as an obscure request failure.
 *
 * The base URL comes from the Endpoint alone — never from a request. That is
 * what stops a caller who reached this app choosing where a Credential lands.
 */
export function resolveEndpoint(endpoint: Endpoint, env: Environment): EndpointResolution {
  const { credentialEnvVar } = endpoint;

  if (credentialEnvVar === undefined) {
    return { ok: true, baseURL: endpoint.baseURL, apiKey: undefined };
  }

  const apiKey = env[credentialEnvVar];

  if (!apiKey) {
    return { ok: false, missingEnvVar: credentialEnvVar };
  }

  return { ok: true, baseURL: endpoint.baseURL, apiKey };
}
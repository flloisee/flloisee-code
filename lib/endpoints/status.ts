import { ENDPOINTS } from "./registry";
import { resolveEndpoint, type Environment } from "./resolve";
import type { Endpoint } from "./types";

/**
 * An Endpoint as the interface sees it: enough to name it, choose it, and say
 * whether it can hold a Conversation — and nothing more.
 *
 * Deliberately not carrying the Credential itself. The interface needs to know
 * which variable to set so the reader can go and set it; it never needs to know
 * what is in it.
 */
export type EndpointStatus = {
  id: string;
  name: string;
  /**
   * A Local Endpoint needs no Credential, so this is null; a Cloud Endpoint names
   * the one it needs. Explicitly null rather than absent, because this value is
   * sent as JSON and a missing key would be indistinguishable from a bug.
   */
  credentialEnvVar: string | null;
  /** Whether the Endpoint can receive messages right now. */
  configured: boolean;
};

/**
 * Reads the whole Registry and says which Endpoints are Configured.
 *
 * Every Endpoint is listed either way. Hiding an Endpoint that is missing its
 * Credential would turn a fixable, one-line problem into an Endpoint the reader
 * never knew existed.
 */
export function describeEndpoints(env: Environment): readonly EndpointStatus[] {
  return ENDPOINTS.map((endpoint: Endpoint) => ({
    id: endpoint.id,
    name: endpoint.name,
    credentialEnvVar: endpoint.credentialEnvVar ?? null,
    configured: resolveEndpoint(endpoint, env).ok,
  }));
}
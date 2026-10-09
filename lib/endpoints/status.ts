import { ENDPOINTS, groupOf } from "./registry";
import type { EndpointGroup } from "./groups";
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
  /**
   * Which group the Endpoint is offered under.
   *
   * Decided by the Registry and sent with the rest, so the interface groups the
   * list rather than carrying a second opinion about which providers are
   * recommended — two lists would be free to disagree.
   */
  group: EndpointGroup;
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
    group: groupOf(endpoint),
  }));
}
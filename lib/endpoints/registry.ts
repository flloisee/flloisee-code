import { CLOUD_ENDPOINTS } from "./validate";
import type { Endpoint, LocalEndpoint } from "./types";

/**
 * Local Endpoints are declared by hand rather than drawn from the Catalog:
 * the Catalog covers Cloud Endpoints and reaches no local server, yet these
 * need no Credential and are the fastest path to a working Conversation.
 *
 * models.dev lists LM Studio but the refresh script drops it as loopback, and
 * is silent on Ollama entirely. Both are declared here, at the addresses their
 * own servers listen on. LM Studio's is taken from models.dev, so the two
 * sources agree on where it listens.
 *
 * The starting Model is a placeholder only: Model Discovery asks the Endpoint
 * which Models it has loaded, and replaces this the moment it answers.
 */
export const LOCAL_ENDPOINTS: readonly LocalEndpoint[] = [
  {
    id: "ollama",
    name: "Ollama",
    baseURL: "http://localhost:11434/v1",
    defaultModelId: "llama3.2",
  },
  {
    id: "lmstudio",
    name: "LM Studio",
    // LM Studio's own default port, and the address models.dev records for it.
    baseURL: "http://127.0.0.1:1234/v1",
    defaultModelId: "qwen/qwen3-coder-30b",
  },
];

/**
 * Every Endpoint the app offers: Cloud Endpoints from the Catalog, Local
 * Endpoints declared alongside it.
 *
 * One list, because choosing an Endpoint is one choice. A reader choosing an
 * Endpoint should not have to know which of the two sources it came from, and a
 * Cloud Endpoint with no Credential yet stays in the list so its absence is
 * visible rather than silent.
 */
export const ENDPOINTS: readonly Endpoint[] = [...LOCAL_ENDPOINTS, ...CLOUD_ENDPOINTS];

export { CLOUD_ENDPOINTS };

export function findEndpoint(id: string): Endpoint | undefined {
  return ENDPOINTS.find((endpoint) => endpoint.id === id);
}

/**
 * Every variable name a Credential is known to live in.
 *
 * This is the whole point of it: Key Entry may write one of these names and
 * nothing else. The Registry is the reviewed list of Endpoints, and each one's
 * variable name is the name of the Credential that Endpoint expects — so this is
 * every place a Credential legitimately lives, and the bound on what a write
 * through the interface is allowed to touch.
 */
export const DECLARED_CREDENTIAL_VARS: ReadonlySet<string> = new Set(
  ENDPOINTS.flatMap((endpoint) => (endpoint.credentialEnvVar ? [endpoint.credentialEnvVar] : [])),
);

export function isDeclaredCredentialVar(name: string): boolean {
  return DECLARED_CREDENTIAL_VARS.has(name);
}
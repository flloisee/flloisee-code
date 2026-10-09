import type { EndpointGroup } from "./groups";
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
 * Cloud Endpoints offered ahead of the rest, as ids of Catalog entries.
 *
 * A judgement about which providers a reader is most likely to want, made once
 * and here rather than in the interface, so the grouping is a property of the
 * Registry rather than a presentation detail that could differ between places
 * that read the Registry.
 *
 * The Catalog holds 187 Cloud Endpoints and most are services a reader will
 * never choose: proxies, resellers, regional mirrors of each other. Scrolling
 * past them all to find Groq is the problem these three groups solve, so the
 * group is a short list of widely-known names rather than a long one.
 *
 * Anthropic is absent because the Catalog has no such entry: its native message
 * format is out of scope, and the spec's own words for that are in the Out of
 * Scope list. Claude is reachable through OpenRouter, which is here.
 *
 * A name absent from the Catalog is a load-time failure rather than a silently
 * ignored line — a typo would demote a recommended provider into the other
 * group without anything saying so.
 */
export const RECOMMENDED_CLOUD_IDS: ReadonlySet<string> = new Set([
  "openai",
  "google",
  "openrouter",
  "deepseek",
  "groq",
]);

const cloudIds = new Set(CLOUD_ENDPOINTS.map((endpoint) => endpoint.id));

for (const id of RECOMMENDED_CLOUD_IDS) {
  if (!cloudIds.has(id)) {
    throw new Error(
      `RECOMMENDED_CLOUD_IDS names "${id}", which the Catalog does not hold. ` +
        `A provider meant to be recommended would otherwise appear in "Cloud (Others)" ` +
        `with nothing saying the list had a typo in it.`,
    );
  }
}

/**
 * Which group an Endpoint is offered under.
 *
 * Read off the Endpoint itself rather than stored on it, so that being
 * recommended cannot drift away from the Catalog entry it names — and so that
 * changing the recommendation list regroups every reader of the Registry at
 * once, without a second pass over the data.
 */
export function groupOf(endpoint: Endpoint): EndpointGroup {
  if (!("credentialEnvVar" in endpoint)) return "local";
  return RECOMMENDED_CLOUD_IDS.has(endpoint.id) ? "recommended" : "others";
}

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

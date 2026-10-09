import type { LocalEndpoint } from "./types";

/**
 * Local Endpoints are declared by hand rather than drawn from the Catalog:
 * the Catalog covers cloud providers and has no entry for Ollama, yet Ollama
 * needs no Credential and is the fastest path to a working Conversation.
 */
export const LOCAL_ENDPOINTS: readonly LocalEndpoint[] = [
  {
    id: "ollama",
    name: "Ollama",
    baseURL: "http://localhost:11434/v1",
    defaultModelId: "llama3.2",
  },
];

/** Every Endpoint the app offers, Local Endpoints for now. */
export const ENDPOINTS: readonly LocalEndpoint[] = LOCAL_ENDPOINTS;

export function findEndpoint(id: string): LocalEndpoint | undefined {
  return ENDPOINTS.find((endpoint) => endpoint.id === id);
}
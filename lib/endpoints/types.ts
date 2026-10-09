/**
 * A Local Endpoint — an AI backend served from the machine running the app.
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
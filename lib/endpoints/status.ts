import { ENDPOINTS, groupOf, RESERVED_ENDPOINT_IDS } from "./registry";
import { ENDPOINTS_FILE, readDeclaredEndpoints } from "./custom";
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
  /**
   * The Model in use until the reader picks another.
   *
   * Sent because the interface has to name the chosen Endpoint's starting Model,
   * and it cannot work it out for itself: the Registry holds its Endpoints in a
   * module the browser does not import, precisely because it reaches the Catalog.
   * A declared Endpoint is in the same position for a different reason — it is
   * in a file only the server reads. Both are why this travels with the answer.
   */
  defaultModelId: string;
};

/**
 * Reads the whole Registry and says which Endpoints are Configured.
 *
 * Every Endpoint is listed either way. Hiding an Endpoint that is missing its
 * Credential would turn a fixable, one-line problem into an Endpoint the reader
 * never knew existed.
 *
 * `dir` is taken rather than reached for so that this stays a pure function of
 * what it is handed, and so a test can point it at a directory it controls rather
 * than at the repository it is running in.
 *
 * The two sources are read separately and only joined here. A declared Endpoint
 * that could not be read does not stop the Catalog being listed: a corrupt
 * `.endpoints.json` should cost the reader the Endpoints they added, not the
 * hundred and eighty-nine they did not.
 */
export async function describeEndpoints(
  env: Environment,
  dir: string,
): Promise<{ statuses: readonly EndpointStatus[]; declaredTrouble: string | null }> {
  const declared = await readDeclaredEndpoints(dir, RESERVED_ENDPOINT_IDS);

  const statuses: EndpointStatus[] = [...ENDPOINTS, ...declared.endpoints].map(
    (endpoint: Endpoint): EndpointStatus => ({
      id: endpoint.id,
      name: endpoint.name,
      credentialEnvVar: endpoint.credentialEnvVar ?? null,
      configured: resolveEndpoint(endpoint, env).ok,
      group: groupOf(endpoint),
      defaultModelId: endpoint.defaultModelId,
    }),
  );

  return { statuses, declaredTrouble: declared.malformed ? MALFORMED_ENDPOINTS : null };
}

/**
 * What is said when `.endpoints.json` is there and could not be understood.
 *
 * Named rather than swallowed, and distinct from "there are none of yours",
 * because a reader who declared three Endpoints and can now see none has lost
 * them and needs to know the file is the reason rather than believing they
 * misremembered. It says where the file is, since the fix is editing it and the
 * file is theirs.
 */
const MALFORMED_ENDPOINTS =
  `This app could not read ${ENDPOINTS_FILE}, so any Endpoints you added are not showing. ` +
  "Nothing else is affected — the Endpoints built into the app still work. The file holds a list " +
  'called "endpoints", and nothing was written over it.';
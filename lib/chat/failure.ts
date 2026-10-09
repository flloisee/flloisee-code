// Taken from `ai` rather than `@ai-sdk/provider` so the app depends only on the
// packages it already declares; `ai` re-exports both.
import { APICallError, InvalidResponseDataError, MissingToolResultsError, RetryError } from "ai";

/**
 * Turning a failure into something a reader can act on.
 *
 * Four failures ask four different things of the reader, so they are told
 * apart rather than collapsed into one generic error:
 *
 *   - the Endpoint could not be reached at all, so start it;
 *   - the Credential was refused, so re-enter it in the interface;
 *   - the Model identifier is not one the Endpoint knows, so pick another;
 *   - the Model cannot call Tools at all, so pick another — or turn the Root off.
 *
 * A Response that arrives in an unusable form is a fifth case, because the
 * reader must not be left staring at an empty bubble, and a Conversation
 * carrying a Tool Call that was never answered is a sixth, because the Turn
 * cannot be sent until the reader has done something about it.
 *
 * The upstream error is never quoted. A provider rejects a request by echoing it
 * — key and all — back in the response body, so its text can contain the
 * Credential, a server-side file path, or an internal URL. Every message below
 * is assembled from the Endpoint's own declared name and base URL, which are
 * ours to show, and from a fixed phrase. Nothing derived from the failure
 * reaches the reader, so an error can be screenshotted and shared.
 */

export type FailureContext = {
  /** The Endpoint's declared name, safe to show: it comes from the Registry. */
  endpointName: string;
  /** The Endpoint's own base URL — the one address a reader already knows. */
  baseURL: string;
  /** The Model identifier that was asked for. The reader typed or picked it. */
  modelId: string;
};

/** HTTP statuses that mean the Credential was refused rather than the Model. */
const CREDENTIAL_STATUSES = new Set([401, 403]);

/** Statuses that mean the Endpoint does not know the address or Model asked for. */
const UNKNOWN_MODEL_STATUSES = new Set([404]);

/**
 * The provider's own words for "this Model cannot call Tools".
 *
 * Read to *choose* a message and never shown, which is the whole rule of this
 * file applied to something that has no status to read: 189 Endpoints say this
 * in 189 ways and none of them say it with a code, so the words are all there
 * is. Matching them is loose on purpose — a false positive here sends the
 * reader to change a Model when the real problem was a prompt that was too
 * long, which is why the two conditions beside it exist at all.
 */
const NAMES_TOOL_CALLING = /tool[_ -]?(?:call|use|usage|support)|function[_ -]?call/i;

/**
 * Turns a failure into a message the reader can act on.
 *
 * Returns prose rather than a category: the categories exist here to choose
 * between the messages, and nothing downstream needs to read them back.
 */
export function describeFailure(error: unknown, context: FailureContext): string {
  const { endpointName, baseURL, modelId } = context;

  const apiError = findAPICallError(error);
  const status = apiError?.statusCode;

  // Before every status case, because it is not about the Endpoint at all. A
  // Turn holding a Tool Call with no result is one this app built and sent, so
  // it fails whichever Endpoint it reaches — and the Credential the reader
  // entered has nothing to do with it. Told first, it is also the one thing the
  // reader can act on: every later Turn from this Conversation fails the same
  // way until they do.
  if ([...errorChain(error)].some((candidate) => MissingToolResultsError.isInstance(candidate))) {
    return `This Turn carries a Tool Call the Endpoint never answered, so there is nothing to send. Regenerate the Response, or start a new Conversation.`;
  }

  if (status !== undefined && CREDENTIAL_STATUSES.has(status)) {
    return `${endpointName} rejected the Credential. Re-enter it in the interface, or check that it is still valid.`;
  }

  if (status !== undefined && UNKNOWN_MODEL_STATUSES.has(status)) {
    return `${endpointName} does not recognise the Model "${modelId}". Pick a different one from the list.`;
  }

  if (refusedToolCalling(apiError, status)) {
    return `${endpointName} refused a request carrying these tools, so "${modelId}" cannot read files with them. Pick a different Model that supports tool calling, or turn the Reading Root off.`;
  }

  // A failure with no status at all means the request never got an answer: a
  // refused connection, an unresolvable name, or a timeout. Nothing is listening.
  if (apiError !== undefined && status === undefined) {
    return `Could not reach ${endpointName} at ${baseURL}. Start Ollama, or check that the Endpoint is running.`;
  }

  if (InvalidResponseDataError.isInstance(error)) {
    return `${endpointName} sent a Response in an unexpected form, so there is no answer to show. Check that its base URL points at an OpenAI-compatible API.`;
  }

  if (apiError !== undefined) {
    // A status we have no specific reading of — a 500, or a rate limit. The
    // Endpoint answered, so it is neither unreachable nor misconfigured, and
    // the thing to do is try again.
    return `${endpointName} could not complete the request. This is usually temporary, so trying again may work.`;
  }

  return `${endpointName} could not complete the request, and the reason was not one this app recognises.`;
}

/**
 * Whether this refusal is about the Tools rather than about anything else.
 *
 * Three conditions, and each one is here because the case without it is wrong
 * rather than merely unlikely. The status has to be a refusal — a 500 is the
 * Endpoint failing, not declining. The request has to have carried Tools, so a
 * Turn with no Root cannot be told the Model cannot use them; the error holds
 * the body that was sent, so this reads the request rather than taking the
 * route's word for it. And the words have to name Tool calling, because a 400
 * is also a bad parameter and a prompt that is too long, and a reader sent to
 * change the wrong Model is worse off than one told to try again.
 */
function refusedToolCalling(apiError: APICallError | undefined, status: number | undefined): boolean {
  if (apiError === undefined || status === undefined || status < 400 || status >= 500) return false;
  if (apiError.responseBody === undefined) return false;
  if (!sentTools(apiError.requestBodyValues)) return false;
  return NAMES_TOOL_CALLING.test(apiError.responseBody);
}

/** Whether the request that failed was one this app sent Tools with. */
function sentTools(requestBodyValues: unknown): boolean {
  const tools = (requestBodyValues as { tools?: unknown } | null | undefined)?.tools;
  return Array.isArray(tools) && tools.length > 0;
}

/**
 * Digs the API failure out of whatever the SDK wrapped it in.
 *
 * A connection refused is retried internally and arrives as a RetryError with
 * the real cause in `lastError`, so the chain is followed rather than giving up
 * on the first layer and reporting every retry as "some other problem".
 */
function findAPICallError(error: unknown): APICallError | undefined {
  for (const candidate of errorChain(error)) {
    if (APICallError.isInstance(candidate)) return candidate;
  }
  return undefined;
}

/** The error, then whatever it wraps: a retry's last error, or a cause. */
function* errorChain(error: unknown): Generator<unknown> {
  const seen = new Set<unknown>();
  let current = error;

  while (current && !seen.has(current)) {
    seen.add(current);
    yield current;

    if (RetryError.isInstance(current)) {
      // `lastError` is the failure worth reading; the array holds every attempt.
      current = current.lastError;
      continue;
    }

    current = (current as { cause?: unknown }).cause;
  }
}
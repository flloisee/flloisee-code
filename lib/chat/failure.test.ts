import { APICallError, MissingToolResultsError } from "ai";
import { describe, expect, it } from "vitest";

import { describeFailure, type FailureContext } from "./failure";

/**
 * How a failure reaches the reader.
 *
 * The one rule every case here obeys is that **nothing derived from the failure
 * is quoted back**. A provider rejects a request by echoing it — Credential and
 * all — so its text can carry a secret, and this app's failures get
 * screenshotted. Each test therefore asserts two things: that the message says
 * something the reader can act on, and that none of the provider's own words
 * came with it.
 */

const OLLAMA: FailureContext = {
  endpointName: "Ollama",
  baseURL: "http://localhost:11434/v1",
  modelId: "llama3.2",
};

/** A refusal the way a provider sends one: a status, and the request echoed back. */
function refused(options: {
  statusCode: number;
  responseBody: string;
  requestBodyValues?: unknown;
}): APICallError {
  return new APICallError({
    message: "the provider's own words, which may say anything",
    url: "http://localhost:11434/v1/chat/completions",
    statusCode: options.statusCode,
    responseBody: options.responseBody,
    isRetryable: false,
    requestBodyValues: options.requestBodyValues ?? { model: "llama3.2" },
  });
}

/** The tools this app sends, as the request carries them. */
const SENT_TOOLS = {
  model: "llama3.2",
  tools: [{ type: "function", function: { name: "read_file" } }],
};

describe("a Model that cannot call Tools", () => {
  /**
   * What the provider says, in words this app would never use itself. Asserting
   * against this string rather than against "tool calling" is deliberate: that
   * phrase is legitimately in our own message, and a test that forbade it would
   * be forbidding us from telling the reader what to do.
   */
  const PROVIDER_WORDS = "this build of llama3.2 has no tool support";

  const REFUSAL = refused({
    statusCode: 400,
    responseBody: `{"error":{"message":"${PROVIDER_WORDS}","code":"model_not_supported"}}`,
    requestBodyValues: SENT_TOOLS,
  });

  it("is told by name, so the reader knows which Endpoint and which Model to change", () => {
    const described = describeFailure(REFUSAL, OLLAMA);

    expect(described).toContain("Ollama");
    expect(described).toContain("llama3.2");
  });

  it("is given something to do about it", () => {
    expect(describeFailure(REFUSAL, OLLAMA)).toMatch(/different Model|turn the Reading Root off/i);
  });

  it("quotes nothing from the provider, which echoes the request back", () => {
    const described = describeFailure(REFUSAL, OLLAMA);

    expect(described).not.toContain(PROVIDER_WORDS);
    expect(described).not.toContain("model_not_supported");
    expect(described).not.toContain("the provider's own words");
  });

  it("is not claimed on a refusal that never mentioned Tools", () => {
    // A 400 is also a bad parameter or a prompt that is too long. Saying the
    // Model cannot call Tools there would send the reader off to change the
    // wrong setting.
    const refusedForAnotherReason = refused({
      statusCode: 400,
      responseBody: '{"error":{"message":"maximum context length is 4096 tokens"}}',
      requestBodyValues: SENT_TOOLS,
    });

    expect(describeFailure(refusedForAnotherReason, OLLAMA)).not.toMatch(/Reading Root|these tools/i);
  });

  it("is not claimed on a Turn that sent no Tools to refuse in the first place", () => {
    const withoutTools = refused({
      statusCode: 400,
      responseBody: '{"error":{"message":"tool calling is not supported"}}',
      requestBodyValues: { model: "llama3.2" },
    });

    expect(describeFailure(withoutTools, OLLAMA)).not.toMatch(/these tools/i);
  });
});

describe("a Conversation carrying a Tool Call that was never answered", () => {
  const MISSING = new MissingToolResultsError({ toolCallIds: ["call_1"] });

  it("is described rather than passed through raw", () => {
    const described = describeFailure(MISSING, OLLAMA);

    expect(described).not.toContain("MissingToolResults");
    expect(described).not.toContain("call_1");
    expect(described).toMatch(/Regenerate|new Conversation/i);
  });

  it("is found however the SDK wrapped it, because a retry wraps what it retries", () => {
    const wrapped = new APICallError({
      message: "wrapped",
      url: "http://localhost:11434/v1/chat/completions",
      requestBodyValues: { model: "llama3.2" },
      isRetryable: false,
      cause: { cause: MISSING },
    });

    expect(describeFailure(wrapped, OLLAMA)).toMatch(/Regenerate|new Conversation/i);
  });
});

describe("a failure the reader can already act on", () => {
  it("still names the Credential when the Endpoint refuses one", () => {
    expect(
      describeFailure(refused({ statusCode: 401, responseBody: "{}" }), OLLAMA),
    ).toContain("Ollama");
  });

  it("still names the Model when the Endpoint does not know it", () => {
    expect(
      describeFailure(refused({ statusCode: 404, responseBody: "{}" }), OLLAMA),
    ).toContain("llama3.2");
  });
});

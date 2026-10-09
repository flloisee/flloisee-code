import { convertToModelMessages, simulateReadableStream, streamText, type UIMessage } from "ai";
import { MockLanguageModelV4 } from "ai/test";

/**
 * Whether a history is one the Endpoint will be sent at all.
 *
 * A Saved Conversation is only worth anything if it can be carried into the next
 * Turn, and the check on that is not a property anyone can read off the record:
 * the SDK converts a history in the browser's own words and one layer further in
 * the provider rejects a Tool Call that never came back. `MissingToolResultsError`
 * is raised *inside* `streamText`, after the conversion has already succeeded,
 * and reaches the reader as an error part inside a stream that answered 200 —
 * which is why "we wrote it down without throwing" is not the same claim as "it
 * will be accepted next time".
 *
 * So this runs the shipping path end to end rather than re-deriving the SDK's
 * rule: the same `convertToModelMessages` the Route Handler calls, then the same
 * `streamText`, against a Model that answers and records nothing. Anything that
 * would stop the real call from being made surfaces here as the error the SDK
 * raises, with the SDK's own name and message.
 *
 * The Model is a stand-in and nothing else is: no history is filtered, no part
 * dropped, and no option passed that the route does not pass.
 */

/**
 * The error the Endpoint boundary raises for `messages`, or `null` if it would
 * have sent them.
 *
 * A `string` naming the failure would be easier to assert on and worse as
 * evidence — `MissingToolResultsError` being the thing under test is most of the
 * point, so the error itself is returned rather than a summary of it.
 */
export async function rejectionFor(messages: UIMessage[]): Promise<Error | null> {
  const model = new MockLanguageModelV4({
    doStream: async () => ({ stream: answered() }),
  });

  // The Route Handler casts the validated messages into the shape the SDK's
  // conversion takes (it is `Array<Omit<UIMessage, "id">>` and the browser's
  // messages carry an id), and passes no options at all. Both are mirrored here,
  // because a history this helper accepts and the route rejects would be a
  // helper that answered a different question.
  const result = streamText({
    model,
    messages: await convertToModelMessages(
      messages as Parameters<typeof convertToModelMessages>[0],
    ),
  });

  for await (const part of result.fullStream) {
    if (part.type === "error") {
      return part.error instanceof Error ? part.error : new Error(String(part.error));
    }
  }

  return null;
}

/**
 * A Model that answers once and finishes, so a rejected history is the only way
 * this can fail.
 *
 * `never` rather than the SDK's own stream-part type, which `ai` does not
 * re-export: the chunks are exactly the ones the SDK emits for a one-word answer
 * and nothing here reads them, so the only thing that matters is that the stream
 * finishes cleanly rather than ending on nothing at all — a truncated stream
 * fails with `NoOutputGeneratedError` and would be mistaken for a rejected
 * history.
 */
function answered(): ReadableStream<never> {
  return simulateReadableStream({
    chunks: [
      { type: "stream-start", warnings: [] },
      {
        type: "response-metadata",
        id: "resp_1",
        modelId: "stub",
        timestamp: new Date(0),
      },
      { type: "text-start", id: "t1" },
      { type: "text-delta", id: "t1", delta: "ok" },
      { type: "text-end", id: "t1" },
      {
        type: "finish",
        finishReason: "stop",
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      },
    ] as never[],
  });
}
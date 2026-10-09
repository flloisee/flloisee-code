import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { convertToModelMessages, isStepCount, streamText } from "ai";
import { z } from "zod";

import { describeFailure } from "@/lib/chat/failure";
import { attachNamedFiles } from "@/lib/chat/attach-named-files";
import { findEndpoint } from "@/lib/endpoints/registry";
import { resolveEndpoint } from "@/lib/endpoints/resolve";
import { readReadingRoot } from "@/lib/roots/reading-root";
import { fileTools } from "@/lib/tools/file-tools";
import { readingApproval } from "@/lib/tools/approval";
import { toolApprovalSecret } from "@/lib/tools/approval-secret";
import { READING_INSTRUCTIONS } from "@/lib/tools/instructions";

/**
 * How long one Turn may take.
 *
 * A generous ceiling for a long generation, and a tool Turn needs more of it
 * rather than less: eight steps against a loaded local Model is eight round
 * trips, none of which is this app's to shorten. Streaming Responses should not
 * be cut short, and a Turn cut short reads to the reader as the Endpoint
 * hanging rather than as a ceiling doing its job.
 */
export const maxDuration = 300;

/**
 * How many steps one Turn may take when the Model can read files.
 *
 * Not a tuning decision, and not optional. `streamText` defaults to
 * `isStepCount(1)`, which is one step: the Model produces a Tool Call and the
 * loop stops without ever reading the result, so omitting this leaves the Tools
 * inert rather than merely slow. The 20 the SDK's documentation quotes as the
 * default belongs to `ToolLoopAgent` and not to `streamText`; verified against
 * the installed package, which says `isStepCount(1)`.
 *
 * Eight is a judgement on top of that floor. A tool loop costs a full round trip
 * per step and burns tokens doing it, small local Models loop when they are
 * unsure, and eight caps a runaway while still letting a question that spans
 * several files be answered in one go.
 */
const STEPS_PER_TURN = 8;

/**
 * One message of the Conversation, as the interface sends it.
 *
 * This is checked rather than cast. `/api/chat` is public, so anything may be
 * POSTed here, and the SDK's `convertToModelMessages` reads `parts` and `role`
 * without checking them: an unvalidated array reaches it and throws
 * `Cannot read properties of undefined`, which leaves the caller with an
 * unhandled 500 that reads as our fault. A malformed message is the caller's
 * mistake, so it gets a 400 saying so.
 *
 * Parts are checked only as far as the SDK reads them, which is an object
 * naming a `type`. A part's own fields belong to the SDK's types; pinning every
 * one here would duplicate them and go stale the moment the SDK adds a part.
 * Each schema therefore passes unknown keys through untouched: a part's `text`
 * is the message itself, and stripping it would empty the Conversation rather
 * than forward it.
 *
 * The one cast below is on validated data, not on `unknown`: it says that a
 * checked message satisfies the SDK's part types, which is the SDK's business
 * and not this route's to restate. What protects the public route is the
 * `safeParse` above, and that runs before the cast is ever reached.
 */
const messagePartSchema = z.looseObject({
  type: z.string().min(1),
});

const messageSchema = z.looseObject({
  role: z.enum(["system", "user", "assistant"]),
  parts: z.array(messagePartSchema).min(1),
});

const chatRequestSchema = z.object({
  endpointId: z.string().min(1),
  modelId: z.string().min(1),
  messages: z.array(messageSchema).min(1),
});

/**
 * What the reader's last message of words said, as one string.
 *
 * The composer's `sendMessage({ text })` produces exactly one text part, and that
 * is what is joined here. Everything else a message may hold is passed through
 * untouched rather than flattened, because a part this route does not recognise is
 * still the SDK's business and not a place to reach for the text.
 */
function lastUserText(messages: z.infer<typeof messageSchema>[]): string {
  const last = messages.findLast((message) => message.role === "user");
  if (last === undefined) return "";

  return last.parts
    .filter((part): part is { type: string; text: string } => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n\n");
}

/**
 * The same history with the reader's last message of words replaced.
 *
 * Built rather than mutated, so the caller's array is never altered underneath it
 * — this route does not own what it was sent — and mapped rather than spliced so
 * the message's position and identity are exactly what they were. Only the *last*
 * text part carries the attachment: a message the reader wrote is one block of
 * their words, and appending after any earlier part would interleave their prose
 * with a file's contents.
 */
function replaceLastUserText(
  messages: z.infer<typeof messageSchema>[],
  text: string,
): z.infer<typeof messageSchema>[] {
  const at = messages.findLastIndex((message) => message.role === "user");
  if (at === -1) return messages;

  return messages.map((message, index) => {
    if (index !== at) return message;

    const parts = [...message.parts];
    const last = parts.findLastIndex((part) => part.type === "text");
    if (last === -1) return message;

    parts[last] = { ...parts[last], text };
    return { ...message, parts };
  });
}

export async function POST(request: Request) {
  const parsed = chatRequestSchema.safeParse(await request.json().catch(() => null));

  if (!parsed.success) {
    return Response.json(
      { error: "The request must name an Endpoint, a Model, and at least one message." },
      { status: 400 },
    );
  }

  const { endpointId, modelId, messages } = parsed.data;

  const endpoint = findEndpoint(endpointId);
  if (!endpoint) {
    return Response.json(
      { error: `Unknown Endpoint: ${endpointId}.` },
      { status: 400 },
    );
  }

  const resolution = resolveEndpoint(endpoint, process.env);
  if (!resolution.ok) {
    // Naming the variable is what makes setup obvious without reading source,
    // and the interface is where a Credential is entered. The variable name is
    // ours to show; the value it would hold never is.
    return Response.json(
      {
        error: `${endpoint.name} has no Credential, so it cannot be used yet. Re-enter it in the interface, or set ${resolution.missingEnvVar} in your environment.`,
      },
      { status: 400 },
    );
  }

  // Every Request is proxied: the browser never contacts an Endpoint directly,
  // so no Credential is ever inlined into a request the browser constructs.
  // `apiKey` is the SDK's own option name, not ours; ours is `credential`.
  const provider = createOpenAICompatible({
    name: endpoint.id,
    baseURL: resolution.baseURL,
    ...(resolution.credential ? { apiKey: resolution.credential } : {}),
  });

  // What the app will read, read from a file of its own.
  //
  // **No filesystem path is ever taken from the request.** The browser resends
  // the whole message history each Turn and can post anything to this route, so
  // a Root a caller could name would be an arbitrary-file-read primitive pointed
  // at a server holding every Credential on this machine. The schema above
  // drops unknown keys, and nothing below reads one: the Root comes from
  // `.reading-root.json`, which only this app's own development route writes.
  const reading = await readReadingRoot(process.cwd());

  // Everything about reading is one block and one condition. With no Root
  // declared, none of it is passed at all — not the Tools, not the approval
  // policy, not the instructions, not the step limit — and the Turn behaves
  // exactly as it did in v1. That is a product promise rather than an
  // optimisation: a reader who has not chosen a folder gets no talk of files, no
  // file reads, and no step ceiling to reason about.
  const canRead = reading.root !== null;

  /**
   * The files the reader named in this message, checked again and placed beside
   * their words.
   *
   * **This is the recheck, and it is the only thing standing between a message and
   * a file that is no longer there.** The composer asked about each of these paths
   * before the Turn existed; between that question and this one a file can be
   * deleted and the Root can be moved, and a message that quietly loses a file
   * reads to the Model as a complete answer about the wrong set of files. So the
   * Turn is refused, naming the file, rather than sent short.
   *
   * **What is named is not what is chosen.** The recogniser is the same function
   * the composer used, so the paths checked here are the paths the reader was
   * shown — but no path arrives in a field. The request carries a *message*, this
   * finds paths in it, and each one goes through `mayRead` exactly as a Tool Call
   * does. There is nothing a caller can post to have a path read, which is the
   * property the schema above was written for and the reason it is not weakened
   * here by a list of attachments.
   *
   * Only the last message the reader wrote is rewritten, and only for the copy the
   * Endpoint receives: the bubble in their Conversation keeps their own words, and
   * the Turns before this one are history that has already been dealt with.
   */
  const asked = lastUserText(messages);
  const attached = await attachNamedFiles(reading, asked);
  if (!attached.ok) {
    return Response.json({ error: attached.error }, { status: 400 });
  }
  // Untouched when the message named nothing: a Turn that is not about a file is
  // the Turn it was before this feature, and rebuilding its history to say so
  // would be a change with nothing behind it.
  const withFiles = attached.text === asked ? messages : replaceLastUserText(messages, attached.text);

  // ai@7: streamText returns synchronously and must NOT be awaited.
  // convertToModelMessages is async and MUST be awaited.
  //
  // The abortSignal matters: without it a Stop in the interface would only close
  // the browser's connection, leaving this server still generating against the
  // Endpoint for a Response nobody will ever read. It covers the Tools as well
  // as the generation — the SDK hands the same signal to each Tool's `execute`,
  // and `search_files` passes it to the walk that is looking through the Root.
  //
  // The signing secret matters for the same reason the Root is never taken from
  // the request: the browser resends this whole history each Turn, so without it
  // a caller could edit an approval into one the server never issued. It is set
  // only where approvals exist — with no Root there are no Tools and nothing to
  // sign — and it is one value per process rather than per request, so an
  // approval the reader is about to be asked about is still valid on the Turn
  // they answer it.
  const result = streamText({
    model: provider.chatModel(modelId),
    ...(canRead
      ? {
          tools: fileTools(reading),
          toolApproval: readingApproval(reading),
          experimental_toolApprovalSecret: toolApprovalSecret(),
          instructions: READING_INSTRUCTIONS,
          stopWhen: isStepCount(STEPS_PER_TURN),
        }
      : {}),
    messages: await convertToModelMessages(
      withFiles as Parameters<typeof convertToModelMessages>[0],
    ),
    abortSignal: request.signal,
  });

  // The failure is described here, not left to the SDK's generic message, so
  // the reader knows whether to start Ollama, re-enter a Credential, or pick a
  // different Model. The underlying error is discarded because a provider error
  // echoes the request back — Credential and all — and this text may be
  // screenshotted.
  return result.toUIMessageStreamResponse({
    onError: (error) =>
      describeFailure(error, {
        endpointName: endpoint.name,
        baseURL: resolution.baseURL,
        modelId,
      }),
  });
}

import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { convertToModelMessages, streamText } from "ai";
import { z } from "zod";

import { describeFailure } from "@/lib/chat/failure";
import { findEndpoint } from "@/lib/endpoints/registry";
import { resolveEndpoint } from "@/lib/endpoints/resolve";

/** Generous ceiling for a long generation; streaming Responses should not be cut short. */
export const maxDuration = 300;

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

  // ai@7: streamText returns synchronously and must NOT be awaited.
  // convertToModelMessages is async and MUST be awaited.
  //
  // The abortSignal matters: without it a Stop in the interface would only close
  // the browser's connection, leaving this server still generating against the
  // Endpoint for a Response nobody will ever read.
  const result = streamText({
    model: provider.chatModel(modelId),
    messages: await convertToModelMessages(
      messages as Parameters<typeof convertToModelMessages>[0],
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

import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { convertToModelMessages, streamText } from "ai";
import { z } from "zod";

import { describeFailure } from "@/lib/chat/failure";
import { findEndpoint } from "@/lib/endpoints/registry";
import { resolveEndpoint } from "@/lib/endpoints/resolve";

/** Generous ceiling for a long generation; streaming Responses should not be cut short. */
export const maxDuration = 300;

const chatRequestSchema = z.object({
  endpointId: z.string().min(1),
  modelId: z.string().min(1),
  messages: z.array(z.unknown()).min(1),
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
  const provider = createOpenAICompatible({
    name: endpoint.id,
    baseURL: resolution.baseURL,
    ...(resolution.apiKey ? { apiKey: resolution.apiKey } : {}),
  });

  // ai@7: streamText returns synchronously and must NOT be awaited.
  // convertToModelMessages is async and MUST be awaited.
  //
  // The abortSignal matters: without it a Stop in the interface would only close
  // the browser's connection, leaving this server still generating against the
  // Endpoint for a Response nobody will ever read.
  const result = streamText({
    model: provider.chatModel(modelId),
    messages: await convertToModelMessages(messages as Parameters<typeof convertToModelMessages>[0]),
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

import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { convertToModelMessages, streamText } from "ai";
import { z } from "zod";

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
    return Response.json(
      { error: `${endpoint.name} has no Credential. Set ${resolution.missingEnvVar} and try again.` },
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
  const result = streamText({
    model: provider.chatModel(modelId),
    messages: await convertToModelMessages(messages as Parameters<typeof convertToModelMessages>[0]),
  });

  // The failure is described here, not left to the SDK's generic message, so
  // the reader knows whether to start Ollama or fix a Credential. The
  // underlying error is discarded because a provider error can echo the
  // request back, and this text may be screenshotted.
  return result.toUIMessageStreamResponse({
    onError: () => describeFailure(endpoint.name, resolution.baseURL),
  });
}

/** An unreachable Endpoint and an unrecognised Model are different problems to fix. */
function describeFailure(endpointName: string, baseURL: string): string {
  const isLocal = baseURL.includes("localhost") || baseURL.includes("127.0.0.1");

  if (isLocal) {
    return `Could not reach ${endpointName} at ${baseURL}. Check that it is running and that the Model identifier is one it has loaded.`;
  }

  return `${endpointName} could not complete the request. Check the Model identifier and the Endpoint's Credential.`;
}
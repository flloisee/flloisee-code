import { describe, expect, it } from "vitest";

import { POST } from "@/app/api/chat/route";

function chatRequest(body: unknown): Request {
  return new Request("http://localhost/api/chat", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

const validBody = {
  endpointId: "ollama",
  modelId: "llama3.2",
  messages: [{ id: "m1", role: "user", parts: [{ type: "text", text: "hi" }] }],
};

describe("the chat Route Handler", () => {
  it("rejects an unknown Endpoint id by name, so the cause is obvious", async () => {
    const response = await POST(chatRequest({ ...validBody, endpointId: "nope" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("nope"),
    });
  });

  it("rejects a request with no Endpoint named", async () => {
    const response = await POST(chatRequest({ messages: validBody.messages }));

    expect(response.status).toBe(400);
  });

  it("accepts a request naming a declared Local Endpoint", async () => {
    const response = await POST(chatRequest(validBody));

    // A running Endpoint is absent here, so the request reaches Proxying and
    // fails at the network boundary rather than at our own validation.
    expect(response.status).not.toBe(400);
  });
});
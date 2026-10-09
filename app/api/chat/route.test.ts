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

  // /api/chat is public: any client may POST it. A malformed body must be
  // refused as a bad request rather than reaching the SDK and throwing, which
  // surfaces as an unhandled 500 and reads as our fault rather than the
  // caller's.
  it("rejects a bare string where a message belongs, instead of crashing", async () => {
    const response = await POST(chatRequest({ ...validBody, messages: ["hello"] }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("message"),
    });
  });

  it("rejects an empty object where a message belongs, instead of crashing", async () => {
    const response = await POST(chatRequest({ ...validBody, messages: [{}] }));

    expect(response.status).toBe(400);
  });

  it("rejects a message with no parts, which holds no Conversation", async () => {
    const response = await POST(
      chatRequest({ ...validBody, messages: [{ id: "m1", role: "user", parts: [] }] }),
    );

    expect(response.status).toBe(400);
  });

  it("rejects a message whose role is not one a Conversation is made of", async () => {
    const response = await POST(
      chatRequest({
        ...validBody,
        messages: [{ id: "m1", role: "narrator", parts: [{ type: "text", text: "hi" }] }],
      }),
    );

    expect(response.status).toBe(400);
  });

  it("rejects a part that is not one the interface can render", async () => {
    const response = await POST(
      chatRequest({
        ...validBody,
        messages: [{ id: "m1", role: "user", parts: [{ text: "hi" }] }],
      }),
    );

    expect(response.status).toBe(400);
  });

  it("rejects messages that are not an array at all", async () => {
    const response = await POST(chatRequest({ ...validBody, messages: "hello" }));

    expect(response.status).toBe(400);
  });
});
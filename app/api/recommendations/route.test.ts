import { describe, expect, it } from "vitest";

import { POST } from "@/app/api/recommendations/route";

/**
 * The recommendations route's input surface.
 *
 * The whole reason this route takes no Endpoint is that a reader asking what
 * they could run offline is not yet running anything. That is also the security
 * property: the route reaches Hugging Face, and a caller able to send search
 * terms or name a repository could turn this app into a proxy for fetching
 * something of their choosing.
 *
 * So the only field is a number, bounded at both ends. Every request here is one
 * that is refused before anything leaves the machine.
 */

const post = (body: unknown) =>
  POST(
    new Request("http://localhost/api/recommendations", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    }),
  );

describe("the recommendations route", () => {
  it("refuses a request naming an Endpoint", async () => {
    // The field this route used to have, and the one that would tie
    // recommendations to whatever happened to be loaded.
    expect((await post({ minTokensPerSecond: 50, endpointId: "ollama" })).status).toBe(400);
  });

  it("refuses a request trying to nominate what is looked up", async () => {
    // The shapes that would make it a proxy: search terms, a repository, a size.
    for (const extra of [
      { search: "qwen" },
      { repo: "someone/anything" },
      { model: "x/y" },
      { url: "https://elsewhere.example" },
      { maxBytes: 1 },
    ]) {
      const response = await post({ minTokensPerSecond: 50, ...extra });

      expect(response.status).toBe(400);
    }
  });

  it("refuses a speed that is not a sensible number", async () => {
    // Zero would divide by nothing when working out what fits; a huge number
    // asks for a Model no machine has. Both are refused rather than clamped,
    // so a caller that meant something else finds out.
    for (const minTokensPerSecond of [0, -1, 1.5, 100_000]) {
      expect((await post({ minTokensPerSecond })).status).toBe(400);
    }
  });

  it("refuses a request saying nothing at all", async () => {
    expect((await post({})).status).toBe(400);
  });
});
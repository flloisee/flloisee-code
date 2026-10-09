// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import { readRouteError, readRouteJSON } from "@/lib/http/route-answer";

/**
 * Reading what a Route Handler answered.
 *
 * Two routes are asked the same two questions — is this an error worth showing,
 * and what is the body if it is not JSON — and both had their own copy. The
 * tests below are the behaviour those two copies had in common, pinned once so
 * neither route can drift into answering differently from the other.
 */

describe("reading a Route Handler's body", () => {
  it("parses a JSON answer into the value it carries", async () => {
    const response = new Response(JSON.stringify({ envVar: "GROQ_API_KEY" }), { status: 200 });

    await expect(readRouteJSON(response)).resolves.toEqual({ envVar: "GROQ_API_KEY" });
  });

  it("reports no body rather than throwing when a proxy answers in place of the route", async () => {
    // An HTML error page from a reverse proxy is a real answer to a request the
    // app never got to handle. Throwing on it would turn a routing problem into
    // an unhandled rejection, which is the one thing this exists to stop.
    const response = new Response("<html>502 Bad Gateway</html>", { status: 502 });

    await expect(readRouteJSON(response)).resolves.toBeNull();
  });

  it("reports no body when the answer is truncated before the JSON closes", async () => {
    // A connection dropped mid-response. The bytes that arrived are not
    // something to parse for a message; the absence of one is the answer.
    await expect(readRouteJSON(new Response('{"envVar": "GRO', { status: 200 }))).resolves.toBeNull();
  });
});

describe("reading a Route Handler's error", () => {
  it("takes the message the route wrote, since its wording is deliberate", () => {
    expect(readRouteError({ error: "GROQ_API_KEY is not a declared variable." })).toBe(
      "GROQ_API_KEY is not a declared variable.",
    );
  });

  it("has no message when the route did not write one", () => {
    expect(readRouteError({ envVar: "GROQ_API_KEY" })).toBeUndefined();
  });

  it("has no message for an empty error, since an empty string says nothing", () => {
    // A blank alert is worse than none: it looks like the app has something to
    // say and has failed to say it.
    expect(readRouteError({ error: "" })).toBeUndefined();
  });

  it("has no message when the body is not an object at all", () => {
    expect(readRouteError("a string body")).toBeUndefined();
    expect(readRouteError(null)).toBeUndefined();
    expect(readRouteError(undefined)).toBeUndefined();
    expect(readRouteError(42)).toBeUndefined();
  });

  it("has no message when the error is not text", () => {
    expect(readRouteError({ error: { code: 42 } })).toBeUndefined();
    expect(readRouteError({ error: ["a", "b"] })).toBeUndefined();
  });

  it("leaves the body it read untouched, so a caller may ask again", () => {
    const body = { error: "GROQ_API_KEY is not a declared variable." };

    expect(readRouteError(body)).toBe(readRouteError(body));
    expect(body).toEqual({ error: "GROQ_API_KEY is not a declared variable." });
  });
});
import { z } from "zod";

import { readRouteError, readRouteJSON } from "@/lib/http/route-answer";

/**
 * Asking the recommendations Route Handler from the interface.
 *
 * Goes to this app's own server, like every other request here — the browser
 * never contacts the Hub. The two things this file can say are how fast a
 * Response should be and which of the two fits to show, and the route takes
 * nothing else.
 */

/** Which of the two fits to be shown. Mirrors the route's own enumeration. */
export type Rank = "speed" | "intelligence";

const recommendationSchema = z.object({
  repo: z.string(),
  url: z.string(),
  downloads: z.number(),
  quant: z.string(),
  bytes: z.number(),
  parameters: z.number(),
  tokensPerSecond: z.number(),
});

const recommendationsResponseSchema = z.object({
  applies: z.boolean(),
  reason: z.string().nullish(),
  minTokensPerSecond: z.number(),
  bandwidthBytesPerSecond: z.number().nullable(),
  memoryBytes: z.number().nullable(),
  recommendations: z.array(recommendationSchema),
});

export type Recommendation = z.infer<typeof recommendationSchema>;

/**
 * What the route leaves the interface with.
 *
 * `recommendations` empty is not an error and is not the same as `applies:
 * false`. One means "nothing on the Hub clears that speed here" and the other
 * means "this app cannot tell you", and they ask different things of the reader.
 */
export type RecommendationAnswer =
  | {
      applies: true;
      reason: string | null;
      minTokensPerSecond: number;
      /** The most a Model may occupy at this speed, so an empty list is explicable. */
      largestModelBytes: number | null;
      recommendations: Recommendation[];
    }
  | { applies: false; reason: string; minTokensPerSecond: number }
  | { status: "unavailable"; message: string };

/** Reads one answer from the recommendations Route Handler. */
export function readRecommendationAnswer({
  status,
  body,
}: {
  status: number;
  body: unknown;
}): RecommendationAnswer {
  if (status === 0) {
    return { status: "unavailable", message: "Could not reach the app's recommendations route." };
  }

  if (status !== 200) {
    return { status: "unavailable", message: readRouteError(body) ?? "The app could not work that out." };
  }

  const parsed = recommendationsResponseSchema.safeParse(body);

  if (!parsed.success) {
    return { status: "unavailable", message: "The recommendations route answered in an unexpected form." };
  }

  const answer = parsed.data;

  if (!answer.applies) {
    return {
      applies: false,
      reason: answer.reason ?? "These Models run elsewhere, so this does not apply.",
      minTokensPerSecond: answer.minTokensPerSecond,
    };
  }

  // The ceiling is the smaller of what memory allows and what the speed allows,
  // computed here rather than sent — the route reports the two facts it knows
  // and this decides which one binds, so there is one place that knows the rule.
  const bandwidth = answer.bandwidthBytesPerSecond;
  const memory = answer.memoryBytes;

  const bySpeed = bandwidth === null ? null : bandwidth / answer.minTokensPerSecond;
  const byMemory = memory === null ? null : memory * 0.9;

  const largest = bySpeed === null ? byMemory : byMemory === null ? bySpeed : Math.min(bySpeed, byMemory);

  return {
    applies: true,
    reason: answer.reason ?? null,
    minTokensPerSecond: answer.minTokensPerSecond,
    largestModelBytes: largest === null || largest <= 0 ? null : largest,
    recommendations: answer.recommendations,
  };
}

/** Asks which Models would run at a given speed on this machine. */
export async function requestRecommendations(
  minTokensPerSecond: number,
  rank: Rank = "speed",
): Promise<RecommendationAnswer> {
  let response: Response;

  try {
    response = await fetch("/api/recommendations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ minTokensPerSecond, rank }),
    });
  } catch {
    return readRecommendationAnswer({ status: 0, body: null });
  }

  return readRecommendationAnswer({
    status: response.status,
    body: await readRouteJSON(response),
  });
}
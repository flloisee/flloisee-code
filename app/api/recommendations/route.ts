import { z } from "zod";

import { probeHardware } from "@/lib/hardware/probe";
import { bandwidthFor } from "@/lib/hardware/bandwidth";
import { usableMemoryBytes } from "@/lib/hardware/spec";
import { whereModelsRun } from "@/lib/hardware/where";
import { recommend, type Recommendation } from "@/lib/huggingface/catalogue";

/**
 * Which Models would run well on this machine.
 *
 * Deliberately takes **no Endpoint**. The first version of this feature asked
 * which Models the selected Endpoint had loaded and reported on those, which is
 * a different question: a reader asking what they could run offline is not yet
 * running anything, and the answer should not depend on what happens to be
 * loaded or on which Endpoint the composer is pointed at.
 *
 * So the inputs are how fast the reader wants a Response to arrive, and which of
 * the two fits to answer — a number and a choice from a closed list. Everything
 * else — the chip, the memory, which machine it is — comes from this server, and
 * every Model comes from Hugging Face. A caller can raise or lower the speed,
 * choose which ordering they are shown, and cannot nominate a repository, a
 * quantisation, a size or a destination, so this route cannot be turned into a
 * proxy for fetching something of the caller's choosing.
 *
 * POST, like every other Route Handler here, and for the same reason: with Cache
 * Components enabled a GET follows the prerender model of a page and the answer
 * would be frozen at build time.
 */

/**
 * Everything a caller may say.
 *
 * A speed, bounded at both ends, and which of the two fits to answer — two values
 * from a closed list. Neither is a path, a host or a repository, so unlike those
 * it cannot be a way of making the server fetch something else: the Hub address
 * is fixed below and the search terms are not in the request at all. The bounds
 * are there because a threshold of zero would divide by nothing and one of ten
 * million would ask for a Model no machine has.
 *
 * `rank` is optional rather than required so that a caller who does not know
 * about it — the tests, and any older client still in a browser tab — gets the
 * default rather than a 400. Being absent cannot select a *third* behaviour,
 * because the enum closes the set at two.
 */
const recommendationRequestSchema = z
  .object({
    minTokensPerSecond: z.number().int().min(1).max(1000),
    rank: z.enum(["speed", "intelligence"]).optional(),
  })
  .strict();

/**
 * Longer than the other routes: this probes the machine's own tools and then
 * asks the Hub for a listing and measures up to twenty repositories, three
 * requests deep. The Hub is a third party on a cold cache.
 */
export const maxDuration = 90;

export async function POST(request: Request) {
  const parsed = recommendationRequestSchema.safeParse(await request.json().catch(() => null));

  if (!parsed.success) {
    return Response.json(
      { error: "The request must say how many tokens a second to recommend for." },
      { status: 400 },
    );
  }

  const { minTokensPerSecond, rank = "speed" } = parsed.data;

  const spec = await probeHardware();
  const placement = await whereModelsRun(process.cwd());

  // The refusal that matters. Everything below computes from `spec`, and `spec`
  // describes the machine serving this app — so when the Models run elsewhere,
  // the answer would be confidently about the wrong computer. Reporting the
  // specs is still true and still useful; reporting fits would not be.
  if (placement.at !== "here") {
    return Response.json({
      applies: false,
      reason: `Your Model server is at ${placement.hosts.join(", ")}, which is not this machine.`,
      minTokensPerSecond,
      bandwidthBytesPerSecond: bandwidthFor(spec),
      memoryBytes: usableMemoryBytes(spec),
      recommendations: [] as Recommendation[],
    });
  }

  const bandwidth = bandwidthFor(spec);

  // No row for this chip means no basis for any estimate. Saying so is the
  // difference between "this machine cannot" and "this app cannot tell", and a
  // reader deserves to know which one they are looking at.
  if (bandwidth === null) {
    return Response.json({
      applies: true,
      reason:
        "No memory bandwidth figure for this machine's chip, so speeds cannot be estimated and nothing is recommended.",
      minTokensPerSecond,
      bandwidthBytesPerSecond: null,
      memoryBytes: usableMemoryBytes(spec),
      recommendations: [] as Recommendation[],
    });
  }

  const recommendations = await recommend({
    minTokensPerSecond,
    bytesPerSecond: bandwidth,
    memoryBytes: usableMemoryBytes(spec) ?? 0,
    rank,
  });

  // `rank` is not echoed back. The interface already knows which fit it asked for,
  // and a field in the answer it cannot contradict is one more thing that could
  // disagree with what the reader is looking at.
  return Response.json({
    applies: true,
    reason: null,
    minTokensPerSecond,
    bandwidthBytesPerSecond: bandwidth,
    memoryBytes: usableMemoryBytes(spec),
    recommendations,
  });
}
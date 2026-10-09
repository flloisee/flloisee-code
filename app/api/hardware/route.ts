import { z } from "zod";

import { probeHardware } from "@/lib/hardware/probe";

/**
 * What this machine is, asked once and answered to the browser.
 *
 * POST, and it takes no parameters at all — not because nothing could be sent,
 * but because nothing should be. The probe shells out to fixed tools, and the
 * rule this route exists to keep is that no part of that decision can be
 * influenced by a caller. There is no argument to make a command from, so
 * there is no argument to make; `.strict()` on an empty object is how that is
 * written down rather than merely observed in a code review.
 *
 * The one thing a caller does get to control is the cache, and deliberately:
 * a machine's hardware does not change between two people looking at it, so
 * it is probed once per process and kept. A reader who has just moved the app
 * to another computer presses Refresh.
 */

/**
 * Nothing is accepted. `.strict()` on an empty shape refuses a body rather
 * than ignoring it, so a future caller that sends `{ platform: "darwin" }` gets
 * a 400 rather than a silent probe of something it chose.
 */
const hardwareRequestSchema = z.object({}).strict();

/** A probe that shells out is short. It does not need a long ceiling. */
export const maxDuration = 15;

export async function POST(request: Request) {
  const parsed = hardwareRequestSchema.safeParse(await request.json().catch(() => null));

  if (!parsed.success) {
    return Response.json(
      { error: "This request takes nothing. It answers about this machine." },
      { status: 400 },
    );
  }

  return Response.json(await probeHardware());
}
import { z } from "zod";

/**
 * Key Entry, from the interface.
 *
 * This carries the Credential one way: from the field the reader typed it into,
 * to the app's own server. Nothing reads one back. The answer the server gives
 * names the variable it was stored in and says whether that value is live —
 * never the value itself, and there is no code path here that could hold one.
 */

/**
 * Whether Key Entry is offered at all.
 *
 * The key entry route refuses to write a Credential outside development and
 * answers 404, so an interface that offered the button everywhere would be
 * offering a button that can only ever fail. This is the single place that
 * decides, so the picker does not have to know why.
 */
export function keyEntryIsAvailable(): boolean {
  return process.env.NODE_ENV === "development";
}

const keyEntryResponseSchema = z.object({
  envVar: z.string(),
  applied: z.boolean(),
  shadowedByShell: z.boolean(),
});

/**
 * What Key Entry leaves the interface with.
 *
 * Every outcome is kept distinct rather than collapsed into success or failure,
 * because they ask different things of the reader:
 *
 * - `stored`: the environment carries what was just written.
 * - `shadowed`: the file was written, but a shell export is serving a different
 *   value. It looks stored and is not in use, which is the one outcome where a
 *   bare success would be a lie.
 * - `refused`: nothing was written, and the route says why in words worth showing.
 */
export type KeyEntryAnswer =
  | { status: "stored"; envVar: string }
  | { status: "shadowed"; envVar: string }
  | { status: "refused"; message: string };

/**
 * Reads one answer from the key entry Route Handler.
 *
 * `status` is the HTTP status, or 0 when the route itself could not be reached.
 */
export function readKeyEntryAnswer({
  status,
  body,
}: {
  status: number;
  body: unknown;
}): KeyEntryAnswer {
  if (status !== 200) {
    // The route's wording is deliberate — it names what was refused and why —
    // so it is shown rather than replaced.
    const message = readError(body);
    if (message) return { status: "refused", message };

    return {
      status: "refused",
      message:
        status === 0
          ? "Could not reach the app's Key Entry route."
          : "The app refused to store that Credential. Nothing was written.",
    };
  }

  const parsed = keyEntryResponseSchema.safeParse(body);

  if (!parsed.success) {
    return {
      status: "refused",
      message: "The app's Key Entry route answered in an unexpected form.",
    };
  }

  return parsed.data.shadowedByShell
    ? { status: "shadowed", envVar: parsed.data.envVar }
    : { status: "stored", envVar: parsed.data.envVar };
}

/**
 * Hands one Credential to the app's server to store.
 *
 * `envVar` is a Catalog-declared variable name, never an Endpoint id: the route
 * accepts only the former, and the Registry is what converts one to the other.
 */
export async function submitCredential({
  envVar,
  credential,
}: {
  envVar: string;
  credential: string;
}): Promise<KeyEntryAnswer> {
  let response: Response;

  try {
    response = await fetch("/api/keys", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ envVar, credential }),
    });
  } catch {
    return readKeyEntryAnswer({ status: 0, body: null });
  }

  return readKeyEntryAnswer({ status: response.status, body: await readBody(response) });
}

async function readBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    // A proxy or an error page answering in place of the route is not a Key Entry
    // outcome, and its bytes are not worth parsing for one.
    return null;
  }
}

function readError(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null) return undefined;

  const error = (body as Record<string, unknown>).error;
  return typeof error === "string" && error.length > 0 ? error : undefined;
}

import { describe, expect, it } from "vitest";

import { POST as hardwarePOST } from "@/app/api/hardware/route";

/**
 * The hardware route's one invariant: it takes nothing.
 *
 * This is not a formality. `probeHardware` shells out to fixed tools, and the
 * rule that no caller can influence that decision is the whole reason the route
 * has no parameters at all. A body with anything in it is refused rather than
 * ignored, so a future caller sending `{ platform: "darwin" }` gets a 400 and
 * learns the rule instead of watching it be quietly not-applied.
 */

describe("the hardware route", () => {
  it("refuses a request carrying anything at all", async () => {
    const response = await hardwarePOST(
      new Request("http://localhost/api/hardware", {
        method: "POST",
        body: JSON.stringify({ platform: "darwin" }),
        headers: { "content-type": "application/json" },
      }),
    );

    expect(response.status).toBe(400);
  });

  it("refuses a request naming something to probe", async () => {
    // The specific shape a caller might reach for: choose the machine, choose
    // the command. Both must be refused.
    for (const body of [{ tool: "system_profiler" }, { command: "nvidia-smi" }, { path: "/etc" }]) {
      const response = await hardwarePOST(
        new Request("http://localhost/api/hardware", {
          method: "POST",
          body: JSON.stringify(body),
          headers: { "content-type": "application/json" },
        }),
      );

      expect(response.status).toBe(400);
    }
  });

  it("refuses a request that is not JSON at all", async () => {
    const response = await hardwarePOST(
      new Request("http://localhost/api/hardware", {
        method: "POST",
        body: "not json",
        headers: { "content-type": "application/json" },
      }),
    );

    expect(response.status).toBe(400);
  });

  it("answers an empty body with this machine's own specs", async () => {
    // The one accepted request. It answers about the machine the app is running
    // on, which is the only machine it knows anything about.
    const response = await hardwarePOST(
      new Request("http://localhost/api/hardware", {
        method: "POST",
        body: "{}",
        headers: { "content-type": "application/json" },
      }),
    );

    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      platform: string;
      memoryBytes: number | null;
      accelerator: { name: string } | null;
    };

    expect(body.platform).toBe(process.platform);
    expect(body.memoryBytes).toBeGreaterThan(0);
    // Whatever it found, it is a real answer about this machine — an
    // accelerator is present or explicitly absent, never a broken shape.
    expect(body.accelerator === null || typeof body.accelerator.name === "string").toBe(true);
  });
});
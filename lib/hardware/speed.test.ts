import { describe, expect, it } from "vitest";

import { bandwidthFor } from "./bandwidth";
import { clearsComfortableSpeed, COMFORTABLE_TOKENS_PER_SECOND, estimateSpeed } from "./speed";
import type { HardwareSpec } from "./spec";

/**
 * The estimate, and the cliff inside it.
 *
 * The interesting behaviour is not the arithmetic — it is a ratio, and a ratio
 * is easy — but what happens either side of the memory boundary. A model that
 * fits and a model that does not differ by an order of magnitude, and that
 * difference is the reason this feature is worth having at all.
 */

/** An M4 with 16 GB of unified memory, which is this author's machine. */
const M4: HardwareSpec = {
  platform: "darwin",
  cpu: "Apple M4",
  cores: 10,
  memoryBytes: 16 * 1024 ** 3,
  accelerator: { name: "Apple M4", kind: "apple", memoryBytes: null, cores: 8 },
};

/** A 4090 with 24 GB. */
const RTX4090: HardwareSpec = {
  platform: "linux",
  cpu: "AMD Ryzen 9 7950X",
  cores: 32,
  memoryBytes: 64 * 1024 ** 3,
  accelerator: { name: "NVIDIA GeForce RTX 4090", kind: "nvidia", memoryBytes: 24 * 1024 ** 3, cores: null },
};

const gib = (n: number) => n * 1024 ** 3;

describe("a model small enough to sit in this machine's memory", () => {
  it("is estimated from the machine's bandwidth divided by the model's size", () => {
    // 4 GB on an M4 at 120 GB/s theoretical, 80% achievable.
    const estimate = estimateSpeed(M4, gib(4));

    expect(estimate.kind).toBe("resident");
    expect(estimate.fits).toBe(true);
    expect(estimate.tokensPerSecond).toBeCloseTo((120 * 0.8 * 1024 ** 3) / gib(4), 0);
  });

  it("clears the comfortable speed on a card with bandwidth to spare", () => {
    // A 7B Q4 is about 4.7 GB, which a 4090 reads at roughly 160 tokens a
    // second. This is the case the feature is for.
    const estimate = estimateSpeed(RTX4090, gib(4.7));

    expect(estimate.fits).toBe(true);
    expect(estimate.tokensPerSecond).toBeGreaterThan(COMFORTABLE_TOKENS_PER_SECOND);
    expect(clearsComfortableSpeed(estimate)).toBe(true);
  });

  it("gets slower as the model gets bigger, as it must", () => {
    // Monotonic in size, which is the property the whole ratio rests on. If
    // this ever inverts, the estimate is dividing by the wrong thing.
    const small = estimateSpeed(RTX4090, gib(4));
    const large = estimateSpeed(RTX4090, gib(16));

    expect(small.tokensPerSecond!).toBeGreaterThan(large.tokensPerSecond!);
  });
});

describe("a model too large for this machine's memory", () => {
  it("is said not to fit, whatever its speed estimate works out to", () => {
    // A 70B Q4 is about 40 GB. No RTX 4090 holds that, and the verdict is the
    // one that matters — not the 25 tok/s the arithmetic alone would give.
    const estimate = estimateSpeed(RTX4090, gib(40));

    expect(estimate.kind).toBe("spilled");
    expect(estimate.fits).toBe(false);
    expect(clearsComfortableSpeed(estimate)).toBe(false);
  });

  it("collapses by about an order of magnitude when it spills", () => {
    // The cliff. A spilled decode reads from disk, which is not slower than
    // VRAM but a different order of magnitude slower, and the estimate has to
    // show that or the feature would recommend a 70B on a 4090.
    const resident = estimateSpeed(RTX4090, gib(20));
    const spilled = estimateSpeed(RTX4090, gib(40));

    expect(spilled.tokensPerSecond!).toBeLessThan(resident.tokensPerSecond! / 5);
  });

  it("is refused on a machine that could not hold it even at memory speed", () => {
    // 16 GB of unified memory and a 40 GB model: the reader is told no, which
    // is the answer that saves them an afternoon.
    expect(estimateSpeed(M4, gib(40)).fits).toBe(false);
  });

  it("leaves headroom rather than fitting exactly to the last byte", () => {
    // A 15.2 GB model on a 16 GB machine would divide at an unhelpfully
    // flattering rate, but leaves nothing for the context and the overhead a
    // real server needs. The threshold sits below the total on purpose.
    expect(estimateSpeed(M4, gib(15.2)).fits).toBe(false);
    expect(estimateSpeed(M4, gib(12)).fits).toBe(true);
  });
});

describe("a machine the table cannot speak for", () => {
  const UNKNOWN_CHIP: HardwareSpec = {
    ...RTX4090,
    accelerator: { name: "Some Future Accelerator", kind: "amd", memoryBytes: 32 * 1024 ** 3, cores: null },
  };

  it("gives no rate rather than a guess", () => {
    // The honest answer. A reader told "unknown" can go and look; a reader told
    // a number from a guessed bandwidth will believe it.
    const estimate = estimateSpeed(UNKNOWN_CHIP, gib(4));

    expect(estimate.kind).toBe("unknown-bandwidth");
    expect(estimate.tokensPerSecond).toBeNull();
    expect(estimate.fits).toBeNull();
  });

  it("does not claim such a machine is too slow", () => {
    // "We cannot tell" and "no" are different answers, and conflating them
    // would mark a future accelerator as unusable.
    expect(clearsComfortableSpeed(estimateSpeed(UNKNOWN_CHIP, gib(4)))).toBe(false);
    expect(estimateSpeed(UNKNOWN_CHIP, gib(4)).fits).toBeNull();
  });
});

describe("a model whose size nobody could look up", () => {
  it("is reported as unknown rather than as small", () => {
    // A model size of zero would divide to infinity, and null would be read as
    // no model at all. Both would be wrong; the estimate says so instead.
    const estimate = estimateSpeed(M4, null);

    expect(estimate.kind).toBe("unknown-size");
    expect(estimate.tokensPerSecond).toBeNull();
    expect(estimateSpeed(M4, 0).kind).toBe("unknown-size");
  });
});

describe("the size of this machine's memory", () => {
  it("is what the estimate divides against, whether or not a GPU has its own", () => {
    // The same model on the same card: the discrete 4090 has its own 24 GB
    // pool, the M4 shares the machine's 16. Two different verdicts from one
    // function, and both correct.
    const onCard = estimateSpeed(RTX4090, gib(20));
    const onUnified = estimateSpeed(M4, gib(20));

    expect(onCard.fits).toBe(true);
    expect(onUnified.fits).toBe(false);
  });

  it("is read from the accelerator where there is one", () => {
    // Guards the wiring: a 24 GB card on a 16 GB machine must be allowed to
    // hold a 20 GB model, which the machine's own RAM would forbid.
    const smallMachineWithBigCard: HardwareSpec = { ...M4, accelerator: RTX4090.accelerator };

    expect(estimateSpeed(smallMachineWithBigCard, gib(20)).fits).toBe(true);
    expect(bandwidthFor(smallMachineWithBigCard)).not.toBeNull();
  });
});
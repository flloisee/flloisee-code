import { describe, expect, it } from "vitest";

import { chooseQuant, quantIn, readQuantSizes, roughSizeBytes } from "./quant";

/**
 * Reading quantised weights out of a file listing.
 *
 * Every listing below is captured from a real Hugging Face repository rather
 * than invented. That matters more here than anywhere else in this feature: the
 * three failures this module exists to prevent all produce a plausible number
 * rather than an obvious one, so a listing written to match what the code
 * expects would have passed against all three.
 */

describe("a repository carrying auxiliary weights beside the Model", () => {
  // The shape every multimodal Gemma repository has: a projector, a prediction
  // head, and the language model itself. The projector is 630 MB against the
  // model's own 5 GB, so a rule taking the smallest Model-looking file picks
  // the projector and reports the Model as running several times faster than a
  // Model of that size ever could.
  const WITH_PROJECTOR = [
    { path: "gemma-3-4b-it-Q8_0-mmproj-f16.gguf", size: 629_597_952 },
    { path: "gemma-3-4b-it-Q4_K_M.gguf", size: 2_490_000_000 },
    { path: "gemma-3-4b-it-Q6_K.gguf", size: 3_310_000_000 },
    { path: "gemma-3-4b-it-Q8_0.gguf", size: 4_330_000_000 },
  ];

  it("does not mistake a projector for the Model", () => {
    // The projector is the smallest file in the folder and the easiest thing in
    // a listing to pick by accident.
    const sizes = readQuantSizes(WITH_PROJECTOR);

    expect(sizes.map((size) => size.quant)).not.toContain("F16");
  });

  it("still finds the Model that was beside it", () => {
    // The failure this guards is not "nothing found" — it is finding the wrong
    // thing. Both matter, and the second is the one that ships a wrong number.
    expect(readQuantSizes(WITH_PROJECTOR).map((size) => size.quant)).toEqual([
      "Q4_K_M",
      "Q6_K",
      "Q8_0",
    ]);
  });

  it("does not mistake a multi-token head for the Model either", () => {
    // The same trap in Gemma's naming, where the prediction head is 470 MB and
    // the Model it predicts is 6 GB. Captured from a real Gemma 4 repository.
    const withMtp = [
      { path: "gemma-4-12b-it-MTP-Q8_0.gguf", size: 471_000_000 },
      { path: "gemma-4-12b-it-MTP-BF16.gguf", size: 860_000_000 },
      { path: "gemma4-v2-Q3_K_M.gguf", size: 6_090_000_000 },
    ];

    // Q3_K_M is recognised but sits below the quality floor — recognising it is
    // what keeps the two prediction heads from being read as the Model.
    expect(readQuantSizes(withMtp).map((s) => s.quant)).toEqual(["Q3_K_M"]);
  });
});

describe("a Model published as several files", () => {
  // The ordinary layout for anything above a few billion parameters.
  const SHARDED = [
    { path: "model-00001-of-00004-Q4_K_M.gguf", size: 1_500_000_000 },
    { path: "model-00002-of-00004-Q4_K_M.gguf", size: 1_500_000_000 },
    { path: "model-00003-of-00004-Q4_K_M.gguf", size: 1_500_000_000 },
    { path: "model-00004-of-00004-Q4_K_M.gguf", size: 1_500_000_000 },
  ];

  it("is measured as the whole Model rather than one file of it", () => {
    // Reading a single shard reports 1.5 GB for a 6 GB Model, which marks it as
    // comfortably fitting when it is not.
    const sizes = readQuantSizes(SHARDED);

    expect(sizes).toHaveLength(1);
    expect(sizes[0].bytes).toBe(6_000_000_000);
    expect(sizes[0].files).toBe(4);
  });

  it("is discarded rather than half-counted when a shard is missing", () => {
    // Three of four shards is a listing that understates the Model by a
    // quarter. Understating is the dangerous direction — it recommends a Model
    // that does not fit — so the incomplete set is dropped entirely.
    const incomplete = SHARDED.slice(0, 3);

    expect(readQuantSizes(incomplete)).toEqual([]);
  });
});

describe("a quantisation named in a filename", () => {
  it("is read whole, and not as a shorter name inside it", () => {
    // `Q4_K_M` contains `Q4_K`, and matching the short one reports a file a few
    // percent smaller than it is. `IQ4_XS` contains `Q4` in the same way.
    expect(quantIn("Qwen3-8B-Q4_K_M.gguf")).toBe("Q4_K_M");
    expect(quantIn("model-IQ4_XS.gguf")).toBe("IQ4_XS");
    expect(quantIn("gemma-3-4b-it-Q5_K_M.gguf")).toBe("Q5_K_M");
  });

  it("is found whatever separates it from the name", () => {
    for (const name of ["model-Q6_K.gguf", "model.Q6_K.gguf", "model Q6_K.gguf", "model-Q6_K-00001-of-00002.gguf"]) {
      expect(quantIn(name)).toBe("Q6_K");
    }
  });

  it("is not found in the middle of a longer word", () => {
    // A boundary is required either side, so `Q6_K` is not read out of a name
    // that merely contains those letters.
    expect(quantIn("XQ6_KY-model.gguf")).toBeNull();
  });
});

describe("the quantisation to recommend", () => {
  // A real repository: `bartowski/Llama-3.2-3B-Instruct-GGUF`, quantised from
  // 2-bit up. Sizes as published.
  const LLAMA = readQuantSizes([
    { path: "Llama-3.2-3B-Instruct-IQ3_M.gguf", size: 1_600_000_000 },
    { path: "Llama-3.2-3B-Instruct-Q3_K_L.gguf", size: 1_820_000_000 },
    { path: "Llama-3.2-3B-Instruct-Q4_K_S.gguf", size: 1_930_000_000 },
    { path: "Llama-3.2-3B-Instruct-Q4_K_M.gguf", size: 2_020_000_000 },
    { path: "Llama-3.2-3B-Instruct-Q5_K_M.gguf", size: 2_270_000_000 },
    { path: "Llama-3.2-3B-Instruct-Q8_0.gguf", size: 3_240_000_000 },
  ]);

  it("is the standard default rather than the biggest that fits", () => {
    // The rule, and the bug a live run on a 16 GB M4 exposed: picking "the best
    // quality that fits" reaches for Q8_0 whenever the budget allows it, and
    // BF16 when the budget is generous. That is the largest download available
    // for a difference in output quality nobody would notice.
    expect(chooseQuant(LLAMA, 100_000_000_000)?.quant).toBe("Q4_K_M");
  });

  it("never offers full precision, whatever room there is", () => {
    // Captured from a live run that recommended `Qwen3.8-2B-Distill-GGUF` at
    // BF16 and 3.90 GB — a triple-size download for a Model whose Q4_K_M file is
    // under 1.3 GB.
    const withFullPrecision = readQuantSizes([
      { path: "model-BF16.gguf", size: 3_900_000_000 },
      { path: "model-Q4_K_M.gguf", size: 1_250_000_000 },
      { path: "model-Q8_0.gguf", size: 2_100_000_000 },
    ]);

    expect(chooseQuant(withFullPrecision, 8_000_000_000)?.quant).toBe("Q4_K_M");
  });

  it("takes the largest that fits when nothing at the bar does", () => {
    // A Model too large for this machine at any decent quality still gets the
    // best available rather than nothing.
    //
    // `Q3_K_L` is the answer here and its name is misleading: at 4.27 bits it
    // sits above the 4-bit floor and below the Q4_K_M bar, which is exactly the
    // band this branch exists for. The fixture also contains `IQ3_M` at 1.6 GB,
    // which is *smaller* and would be the better download — and is correctly
    // refused, because at 3.66 bits it is under the floor.
    expect(chooseQuant(LLAMA, 1_900_000_000)?.quant).toBe("Q3_K_L");
  });

  it("refuses a quantisation below the floor even when it is the only one that fits", () => {
    // `IQ3_M` is the smallest file in the fixture and fits any budget above
    // 1.6 GB. It is still not offered: 3.66 bits is where a Model stops being a
    // Model, and a fast wrong answer is worse than a slow right one.
    expect(chooseQuant(LLAMA, 1_700_000_000)).toBeNull();
  });

  it("never recommends a quantisation below four bits, however much room there is", () => {
    // The trap this floor exists for. A 2-bit quantisation of a large Model
    // decodes quickly *because* it carries less of the Model, so ranking on
    // tokens per second alone is ranking on how badly the Model survives.
    expect(chooseQuant([{ quant: "IQ2_XXS", bytes: 900_000_000, files: 1 }], 100_000_000_000)).toBeNull();
  });

  it("reports that no version of a Model fits, rather than the worst one", () => {
    // Null means the reader is told nothing will do, which is what they need to
    // hear. Returning the smallest available would recommend a 2-bit file as
    // though it were the answer.
    expect(chooseQuant(LLAMA, 500_000_000)).toBeNull();
  });
});

describe("a first guess at a Model's size, before measuring it", () => {
  it("is a lower bound, so a Model is never rejected for being too large", () => {
    // `gguf.total` is a parameter count in bytes: Qwen3-8B reports 8.19 GB
    // there while its Q4_K_M file is 5.03 GB. Reading it as a size would
    // overstate every Model by roughly the quantisation ratio and reject
    // Models that would have fitted.
    //
    // The guess is computed at the 4-bit floor rather than at Q4_K_M's 4.85,
    // which puts it *below* the true size of the file it is estimating. That is
    // the direction it has to err: over-stating rejects Models that would have
    // run, under-stating only costs one extra measurement.
    expect(roughSizeBytes(8_190_000_000)).toBeLessThanOrEqual(5_030_000_000);
    expect(roughSizeBytes(8_190_000_000)).toBeLessThan(8_190_000_000);
  });

  it("scales with the Model rather than being a flat guess", () => {
    const threeB = roughSizeBytes(3_210_000_000);
    const thirtyB = roughSizeBytes(32_100_000_000);

    expect(thirtyB / threeB).toBeCloseTo(10, 0);
  });
});
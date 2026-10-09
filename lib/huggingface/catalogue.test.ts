import { afterEach, describe, expect, it, vi } from "vitest";

import { recommend, RECOMMENDATION_LIMIT, type Request } from "./catalogue";

/**
 * Which Models are put in front of this reader.
 *
 * The Hub is stubbed throughout. What is being tested is the arithmetic and the
 * refusals — how a budget becomes a shortlist, and what happens at the edges —
 * and a test that reached the network would be testing Hub uptime and the
 * relative popularity of whichever models shipped this week.
 *
 * The listings below are shaped like the real ones, including the parameter
 * counts, because the cheap filter is part of what is under test.
 */

/** An RTX 4090 with 24 GB. */
const FAST: Request = {
  minTokensPerSecond: 50,
  memoryBytes: 24 * 1024 ** 3,
  // 1008 GB/s theoretical at 80% achievable.
  bytesPerSecond: Math.round(1008 * 0.8 * 1024 ** 3),
  rank: "speed",
};

/**
 * Answers `/api/models?...` with a listing and `/tree/...` with a file list.
 *
 * Returns the mock, because *which repositories were asked for* is itself worth
 * asserting. How many measurements a fit spends, and on whom, is the difference
 * between the two fits — and a test that only looks at the answer cannot tell a
 * reordered list from a differently-asked question.
 */
function stubHub(listing: unknown[], files: Record<string, unknown[]>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);

    if (url.includes("/tree/")) {
      const repo = repoOf(url);
      const body = files[repo];
      return body === undefined
        ? new Response("not found", { status: 404 })
        : new Response(JSON.stringify(body), { status: 200 });
    }

    return new Response(JSON.stringify(listing), { status: 200 });
  });

  vi.stubGlobal("fetch", fetchMock);

  return fetchMock;
}

/** The repository a file-tree request was about. */
function repoOf(url: string): string {
  return decodeURIComponent(url.split("/api/models/")[1].split("/tree/")[0]);
}

/** The repositories a run actually spent a measurement on. */
function measured(mock: { mock: { calls: unknown[][] } }): string[] {
  return mock.mock.calls
    .map((call) => String(call[0]))
    .filter((url) => url.includes("/tree/"))
    .map(repoOf);
}

/** One listing entry: a repository, its popularity, and its parameter count. */
function entry(repo: string, downloads: number, parameterCountBytes: number) {
  return { id: repo, downloads, gguf: { total: parameterCountBytes } };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("a machine with bandwidth to spare", () => {
  it("offers a Model whose quantisation clears the speed asked for", async () => {
    // Qwen3-8B at Q4_K_M is 5.03 GB. On a 4090 that is roughly 160 tokens a
    // second, comfortably over 50.
    stubHub(
      [entry("Qwen/Qwen3-8B-GGUF", 2_000_000, 8_190_000_000)],
      { "Qwen/Qwen3-8B-GGUF": [{ path: "Qwen3-8B-Q4_K_M.gguf", size: 5_030_000_000 }] },
    );

    const results = await recommend(FAST);

    expect(results).toHaveLength(1);
    expect(results[0].repo).toBe("Qwen/Qwen3-8B-GGUF");
    expect(results[0].quant).toBe("Q4_K_M");
    expect(results[0].tokensPerSecond).toBeGreaterThan(50);
  });

  it("offers the standard default quantisation rather than the largest", async () => {
    // A live run on a 16 GB M4 exposed this: picking the best quality that fits
    // reached for Q8_0 wherever the budget allowed, which is the biggest download
    // on offer for a difference nobody would notice in a Conversation.
    stubHub(
      [entry("Qwen/Qwen3-8B-GGUF", 2_000_000, 8_190_000_000)],
      {
        "Qwen/Qwen3-8B-GGUF": [
          { path: "Qwen3-8B-IQ2_XXS.gguf", size: 2_600_000_000 },
          { path: "Qwen3-8B-Q4_K_M.gguf", size: 5_030_000_000 },
          { path: "Qwen3-8B-Q8_0.gguf", size: 8_700_000_000 },
        ],
      },
    );

    expect((await recommend(FAST))[0].quant).toBe("Q4_K_M");
  });

  it("links to the repository page rather than to a file", async () => {
    // The page carries the download button and lists the other quantisations, so
    // a reader who wants a different size can find it without coming back here.
    stubHub(
      [entry("Qwen/Qwen3-8B-GGUF", 1, 8_190_000_000)],
      { "Qwen/Qwen3-8B-GGUF": [{ path: "Qwen3-8B-Q4_K_M.gguf", size: 5_030_000_000 }] },
    );

    expect((await recommend(FAST))[0].url).toBe("https://huggingface.co/Qwen/Qwen3-8B-GGUF");
  });
});

describe("the two ceilings, and which one binds", () => {
  it("is limited by memory when the Model would not fit in it", async () => {
    // 40 GB of weights on a 24 GB card. It clears 50 tokens a second by a mile
    // and still cannot be loaded, which is the case that makes "does it fit"
    // and "is it quick" genuinely different questions.
    stubHub(
      [entry("big/70b-GGUF", 5_000_000, 70_000_000_000)],
      { "big/70b-GGUF": [{ path: "70b-Q4_K_M.gguf", size: 40_000_000_000 }] },
    );

    expect(await recommend(FAST)).toEqual([]);
  });

  it("is limited by speed when the Model is small enough but too slow", async () => {
    // The same Model, asked for at a speed nothing on the Hub reaches. A Model
    // that would fit perfectly is still not one to offer at 200 tokens a second.
    const impossible: Request = { ...FAST, minTokensPerSecond: 200 };

    stubHub(
      [entry("Qwen/Qwen3-8B-GGUF", 1, 8_190_000_000)],
      { "Qwen/Qwen3-8B-GGUF": [{ path: "Qwen3-8B-Q4_K_M.gguf", size: 5_030_000_000 }] },
    );

    expect(await recommend(impossible)).toEqual([]);
  });
});

describe("a machine this app cannot estimate for", () => {
  it("offers nothing rather than guessing", async () => {
    // No bandwidth figure for the chip means no basis for any number. An empty
    // list here is honest; a list built from a guessed bandwidth would not be.
    stubHub([entry("Qwen/Qwen3-8B-GGUF", 1, 8_190_000_000)], {
      "Qwen/Qwen3-8B-GGUF": [{ path: "Qwen3-8B-Q4_K_M.gguf", size: 5_030_000_000 }],
    });

    expect(await recommend({ ...FAST, bytesPerSecond: null })).toEqual([]);
  });
});

describe("the Hub answering with nothing usable", () => {
  it("offers nothing when the listing cannot be read", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));

    expect(await recommend(FAST)).toEqual([]);
  });

  it("drops a repository it could not measure, rather than guessing at it", async () => {
    // A 404 on the file tree means this Model's size is unknown. There is no
    // partial answer for a size, and a plausible figure for a Model nobody
    // measured is the one thing this must never produce.
    stubHub([entry("Qwen/Qwen3-8B-GGUF", 1, 8_190_000_000)], {});

    expect(await recommend(FAST)).toEqual([]);
  });

  it("asks the Hub for nothing that cannot possibly fit", async () => {
    // The cheap filter is the whole cost argument: measuring a repository costs
    // a request, so the ones that cannot fit at four bits are dropped first.
    const fetchMock = vi.fn(async () => new Response(JSON.stringify([]), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await recommend(FAST);

    expect(fetchMock.mock.calls.length).toBe(1);
  });
});

describe("the list put in front of the reader", () => {
  it("is ordered by how many people downloaded each Model", async () => {
    // Downloads is somebody else's judgement rather than this app's, and the
    // Hub's ordering is current where a curated table in source would not be.
    const listing = [
      entry("obscure/small-GGUF", 500, 3_000_000_000),
      entry("popular/large-GGUF", 9_000_000, 8_000_000_000),
    ];
    const files = {
      "obscure/small-GGUF": [{ path: "s-Q4_K_M.gguf", size: 2_000_000_000 }],
      "popular/large-GGUF": [{ path: "l-Q4_K_M.gguf", size: 5_000_000_000 }],
    };
    stubHub(listing, files);

    const results = await recommend(FAST);

    expect(results[0].repo).toBe("popular/large-GGUF");
  });

  it("is short enough to be read to the end", async () => {
    const listing = Array.from({ length: 40 }, (_, at) =>
      entry(`org/model-${at}-GGUF`, 10_000 - at, 4_000_000_000),
    );
    const files = Object.fromEntries(
      listing.map((item) => [
        item.id,
        [{ path: `m-Q4_K_M.gguf`, size: 2_000_000_000 }],
      ]),
    );
    stubHub(listing, files);

    expect(await recommend(FAST)).toHaveLength(RECOMMENDATION_LIMIT);
  });
});

describe("the two fits, asked the same question", () => {
  // Twenty small Models the Hub is heavily used with, and five much larger ones
  // almost nobody has downloaded. Which twenty get *measured* is the whole
  // difference between the fits, so this fixture is built to make the two
  // windows disagree: ranked by downloads the window is entirely small, and a
  // list re-ordered by size would still be a list of small Models.
  const manySmall = Array.from({ length: 20 }, (_, at) =>
    entry(`small/model-${at}-GGUF`, 5_000_000 - at, 1_000_000_000),
  );
  const fewLarge = Array.from({ length: 5 }, (_, at) =>
    entry(`large/model-${at}-GGUF`, 100 - at, 20_000_000_000),
  );
  const listing = [...manySmall, ...fewLarge];

  const files = Object.fromEntries(
    listing.map((item) => [
      item.id,
      // Realistic for the parameter count: a 1B at Q4_K_M is about 0.6 GB, a 20B
      // about 12 GB. Both clear the 16 GB budget on this machine.
      [{ path: "m-Q4_K_M.gguf", size: item.gguf.total * (4.85 / 8) }],
    ]),
  );

  it("measures the largest Models for the Intelligence fit, not the most downloaded", async () => {
    // The claim this tab rests on. Asking the Hub about the twenty most-downloaded
    // Models would produce twenty small ones, and no amount of reordering those
    // would surface a 20B.
    const spy = stubHub(listing, files);

    await recommend({ ...FAST, rank: "intelligence" });

    expect(measured(spy).filter((repo) => repo.startsWith("large/"))).toHaveLength(5);
  });

  it("measures the most downloaded Models for the Speed fit, unchanged", async () => {
    // The other tab keeps the window it had. Popularity is the whole ordering
    // here, so the candidates worth measuring are the popular ones.
    const spy = stubHub(listing, files);

    await recommend({ ...FAST, rank: "speed" });

    expect(measured(spy).filter((repo) => repo.startsWith("large/"))).toHaveLength(0);
  });

  it("puts the most parameters first, ahead of a more popular smaller Model", async () => {
    stubHub(listing, files);

    const results = await recommend({ ...FAST, rank: "intelligence" });

    // The large ones have 100 downloads against five million. On the other tab
    // they would be nowhere near the list.
    expect(results[0].repo).toMatch(/^large\//);
    expect(results[0].parameters).toBeGreaterThan(15e9);
  });

  it("separates two Models of the same size by how many people downloaded them", async () => {
    // Download count is not demoted to nothing on this fit — it decides between
    // Models that are equally large. It only never overtakes a difference in how
    // much Model is on the disk.
    //
    // 14B at Q4_K_M is about 8.5 GB, inside the 16 GB this machine's budget
    // allows; 4B is about 2.4 GB.
    const tied = [
      entry("less/liked-14b-GGUF", 4_000, 14_000_000_000),
      entry("more/liked-14b-GGUF", 900_000, 14_000_000_000),
      entry("smaller/4b-GGUF", 10, 4_000_000_000),
    ];
    stubHub(
      tied,
      Object.fromEntries(
        tied.map((item) => [item.id, [{ path: "m-Q4_K_M.gguf", size: item.gguf.total * (4.85 / 8) }]]),
      ),
    );

    const results = await recommend({ ...FAST, rank: "intelligence" });

    expect(results.map((item) => item.repo)).toEqual([
      "more/liked-14b-GGUF",
      "less/liked-14b-GGUF",
      "smaller/4b-GGUF",
    ]);
  });

  it("offers on either fit only Models that clear both ceilings", async () => {
    // The budget is shared between the fits, and deliberately so. "Intelligence
    // over speed" is not a second budget that lets a Model through which the
    // Speed fit would refuse — it is the same ceiling, ordered differently. What
    // differs is which twenty candidates are measured, not what the answer to
    // each of them is.
    //
    // Note what this is *not* asserting: that the two fits return the same
    // Models. They cannot — different windows, different candidates — which is
    // the subject of the two tests above.
    stubHub(listing, files);

    const ceiling = Math.min(FAST.memoryBytes, (FAST.bytesPerSecond ?? 0) / FAST.minTokensPerSecond);

    for (const which of ["speed", "intelligence"] as const) {
      for (const row of await recommend({ ...FAST, rank: which })) {
        expect(row.bytes).toBeLessThanOrEqual(ceiling);
        expect(row.tokensPerSecond).toBeGreaterThanOrEqual(FAST.minTokensPerSecond);
      }
    }
  });
});

describe("the prefilter the two fits do not share", () => {
  /**
   * A repository published *only* as a quantisation below the floor.
   *
   * This is the shape that makes a large machine look empty. At 235B parameters a
   * 4-bit guess says 117 GB, which fits a 192 GB machine comfortably; a Q4_K_M
   * guess says 142 GB, which does not. So a prefilter at the floor lets it
   * through, spends a measurement on it, and then `chooseQuant` refuses the only
   * file in the repository — twenty measurements spent, nothing returned.
   */
  const onlyA2Bit = (at: number) => {
    const repo = `huge/iq2-only-${at}-GGUF`;

    return {
      repo,
      entry: entry(repo, 500 - at, 235_000_000_000),
      files: [{ path: "m-IQ2_XXS.gguf", size: 60_000_000_000 }],
    };
  };

  /** A Mac Studio: 192 GB, 800 GB/s, and a slider at its floor. */
  const HUGE: Request = {
    minTokensPerSecond: 5,
    memoryBytes: 192 * 1024 ** 3,
    bytesPerSecond: Math.round(800 * 0.8 * 1024 ** 3),
    rank: "intelligence",
  };

  it("does not spend measurements on Models that could only be offered below the quality bar", async () => {
    // The models this prefilter exists to skip. They pass a 4-bit guess and fail
    // a Q4_K_M one, which is the only signal available before a file is read.
    const noise = Array.from({ length: 25 }, (_, at) => onlyA2Bit(at));
    const wanted = entry("good/30b-GGUF", 10, 30_000_000_000);

    const spy = stubHub(
      [...noise.map((item) => item.entry), wanted],
      { ...Object.fromEntries(noise.map((item) => [item.repo, item.files])), "good/30b-GGUF": [{ path: "m-Q4_K_M.gguf", size: 18_000_000_000 }] },
    );

    await recommend(HUGE);

    expect(measured(spy).filter((repo) => repo.startsWith("huge/"))).toEqual([]);
  });

  it("still finds the Model worth recommending on that hardware", async () => {
    // The point of the prefilter. With it, the twenty slots go to Models that can
    // actually be offered and the list is not empty; without it they would be
    // filled by twenty 235B repositories that all fail the quality floor, and a
    // machine large enough for a good answer would be shown nothing at all.
    const noise = Array.from({ length: 25 }, (_, at) => onlyA2Bit(at));
    const wanted = entry("good/30b-GGUF", 10, 30_000_000_000);

    stubHub(
      [...noise.map((item) => item.entry), wanted],
      { ...Object.fromEntries(noise.map((item) => [item.repo, item.files])), "good/30b-GGUF": [{ path: "m-Q4_K_M.gguf", size: 18_000_000_000 }] },
    );

    const results = await recommend(HUGE);

    expect(results.map((item) => item.repo)).toEqual(["good/30b-GGUF"]);
  });

  it("still measures them for the Speed fit, which is not looking for the largest", async () => {
    // The prefilter is not a general tightening. Speed fit is ordered by
    // popularity, where a 235B Model nobody has downloaded is a candidate like
    // any other, and the floor is the right bar for a list that will never rank
    // by size.
    const noise = Array.from({ length: 3 }, (_, at) => onlyA2Bit(at));

    const spy = stubHub(noise.map((item) => item.entry), {
      ...Object.fromEntries(noise.map((item) => [item.repo, item.files])),
    });

    await recommend({ ...HUGE, rank: "speed" });

    expect(measured(spy)).toHaveLength(3);
  });
});

describe("the parameter count beside each recommendation", () => {
  it("is worked back from the size of the file it recommends", async () => {
    // Qwen3-8B at Q4_K_M is 5.03 GB, and `5.03e9 × 8 ÷ 4.85` is 8.30B against a
    // real 8.19B — about 1.3% over, because embeddings and the output head are
    // quantised above the nominal bits and so spend more bytes per weight than
    // the assumption gives them credit for.
    stubHub(
      [entry("Qwen/Qwen3-8B-GGUF", 1, 8_190_000_000)],
      { "Qwen/Qwen3-8B-GGUF": [{ path: "Qwen3-8B-Q4_K_M.gguf", size: 5_030_000_000 }] },
    );

    const { parameters } = (await recommend(FAST))[0];

    expect(parameters).toBeGreaterThan(8_000_000_000);
    expect(parameters).toBeLessThan(8_600_000_000);
  });

  it("is a number a reader can check against the size printed beside it", async () => {
    // Why the number shown is derived from the measured file rather than read
    // from the Hub's listing: a reader who divides the two figures they can see
    // gets this one back. The listing's count is still what orders candidates
    // before anything has been measured.
    stubHub(
      [entry("Qwen/Qwen3-8B-GGUF", 1, 8_190_000_000)],
      { "Qwen/Qwen3-8B-GGUF": [{ path: "Qwen3-8B-Q4_K_M.gguf", size: 5_030_000_000 }] },
    );

    const row = (await recommend(FAST))[0];

    // 5.03 GB read as 5,030,000,000 bytes, which is how the file tree reports it.
    expect(row.bytes).toBe(5_030_000_000);
    expect(row.parameters).toBeCloseTo((row.bytes * 8) / 4.85, -4);
  });
});

describe("what leaves the machine", () => {
  it("carries no Credential, even when one is in the environment", async () => {
    // The reader may well have a Hugging Face token exported — it is exactly the
    // Credential that could leak here, and putting it on a request this app does
    // not control would be the worst thing this feature could do.
    const seen: Headers[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        seen.push(new Headers(init?.headers ?? {}));
        return new Response(JSON.stringify([]), { status: 200 });
      }),
    );

    const before = process.env.HF_TOKEN;
    process.env.HF_TOKEN = "hf_a_credential_that_must_not_travel";

    try {
      await recommend(FAST);

      expect(seen.length).toBeGreaterThan(0);
      for (const headers of seen) {
        expect(Object.keys(Object.fromEntries(headers.entries()))).not.toContain("authorization");
        expect([...headers.values()].join(" ")).not.toContain("hf_a_credential");
      }
    } finally {
      if (before === undefined) delete process.env.HF_TOKEN;
      else process.env.HF_TOKEN = before;
    }
  });
});
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
};

/** Answers `/api/models?...` with a listing and `/tree/...` with a file list. */
function stubHub(listing: unknown[], files: Record<string, unknown[]>): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.includes("/tree/")) {
        const repo = decodeURIComponent(url.split("/api/models/")[1].split("/tree/")[0]);
        const body = files[repo];
        return body === undefined
          ? new Response("not found", { status: 404 })
          : new Response(JSON.stringify(body), { status: 200 });
      }

      return new Response(JSON.stringify(listing), { status: 200 });
    }),
  );
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
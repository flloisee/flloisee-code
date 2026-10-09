import {
  chooseQuant,
  parameterCount,
  QUALITY_BAR_BITS,
  QUANT_FLOOR_BITS,
  readQuantSizes,
  roughSizeBytes,
  type QuantSize,
} from "./quant";

/**
 * Finding Models that would run well on this machine.
 *
 * Not searching — **browsing**. The Hub supports a listing with no query at
 * all, filtered to quantised text-generation Models and ordered by downloads,
 * which is what makes "what could I run here" answerable without the reader
 * knowing what to look for. Asking the reader to name a Model first would be
 * answering a question they had already given up on.
 *
 * The work here is measurement, not retrieval. Hugging Face will tell you a
 * Model's parameter count in one cheap listing call, but the size of the file
 * you would actually download is per-quantisation and costs a second request
 * each. So the flow is: one listing, a cheap filter over the parameter counts,
 * then exact measurement of only the survivors.
 *
 * **Two fits, from the same machinery.** They differ in what they put first, and
 * in which twenty candidates are worth measuring — which turns out to be the part
 * that actually matters. Ordering candidates by downloads and then re-sorting the
 * survivors by size would change nothing: the twenty most-downloaded GGUF
 * text-generation Models on the Hub are small ones, so the largest of them is
 * still small. The size fit has to spend its measurements on the largest
 * candidates instead, or it has nothing new to say.
 *
 * Nothing here sends a Credential, and the request it makes carries no
 * information about the reader — see `lib/hardware/where.ts` for why the specs
 * are only acted on when they describe the machine the Models run on.
 */

/** The Hub's public listing API. No key, no header, no Credential. */
const HUB = "https://huggingface.co/api/models";

/** The page of a repository on the Hub, which is where a download actually happens. */
export const repoPage = (repo: string) => `https://huggingface.co/${repo}`;

/** A long request to the Hub, with retries: a size lookup is on the critical path. */
const TIMEOUT_MS = 8000;

/** How many Models to measure exactly. The cost is one request each. */
const MEASURE_LIMIT = 20;

/** How many of those requests may be in flight at once. */
const CONCURRENCY = 4;

/** How many to recommend. More than this is a list nobody reads to the end. */
export const RECOMMENDATION_LIMIT = 8;

/** One Model that would run on this machine, with the quantisation to fetch. */
export type Recommendation = {
  /** The Hub repository, e.g. "Qwen/Qwen3-8B-GGUF". */
  repo: string;
  /** Where the reader goes to download it. */
  url: string;
  /** How many people have downloaded it — the only quality signal available. */
  downloads: number;
  /** The quantisation recommended, named as the repository spells it. */
  quant: string;
  /** Its true size on disk, summed across shards. */
  bytes: number;
  /** How many parameters it has, worked back from the size above. */
  parameters: number;
  /** Estimated tokens a second on this machine. */
  tokensPerSecond: number;
};

/**
 * What the reader is optimising for.
 *
 * `speed` offers what is quickest to talk to; `intelligence` offers the most
 * Model that fits, whatever pace that comes out at. They share a budget and a
 * quantisation rule — the speed the reader asked for puts the same ceiling on
 * size in both — and differ only in what is put first and in which candidates
 * are worth measuring.
 */
export type Rank = "speed" | "intelligence";

/** What the reader asked for, and what the machine can do about it. */
export type Request = {
  /** The least tokens a second worth recommending. */
  minTokensPerSecond: number;
  /** The most a Model may occupy and still fit in memory. */
  memoryBytes: number;
  /** Bytes per second this machine can move, or null when its chip is unknown. */
  bytesPerSecond: number | null;
  /** Which of the two fits to answer. */
  rank: Rank;
};

/**
 * The Models worth putting in front of this reader.
 *
 * An empty list is a real answer and means something specific: at this speed
 * threshold and on this machine, nothing on the Hub clears it. The caller is
 * expected to say so rather than show an empty panel.
 */
export async function recommend(request: Request): Promise<Recommendation[]> {
  if (request.bytesPerSecond === null) return [];

  // The speed the reader asked for and the memory available each put a ceiling
  // on a Model's size, and the lower of the two is the one that binds. A Model
  // that would fit in memory but not clear the speed is not a Model worth
  // offering at that setting, and vice versa.
  //
  // Note that the slider is not disabled on the Intelligence fit — it is what
  // turns it up. Dragged to its floor the bandwidth term grows past what memory
  // allows and memory binds instead, which is exactly "intelligence over speed":
  // the largest Model this machine can hold, at whatever pace that comes to.
  const budget = Math.min(request.memoryBytes, request.bytesPerSecond / request.minTokensPerSecond);

  if (budget <= 0) return [];

  const measured = await measureCandidates(budget, request.rank);

  const recommendations: Recommendation[] = [];

  for (const candidate of measured) {
    const quant = chooseQuant(candidate.quants, budget);
    // No quantisation at or above the quality floor fits. That Model does not
    // run at this speed on this machine, and offering a 2-bit version of it
    // instead would be offering something that answers in noise.
    if (quant === null) continue;

    const parameters = parameterCount(quant.bytes, quant.quant);
    // The quantisation was chosen out of this module's own table, so its name is
    // one `bitsFor` recognises. A null here means the two tables have drifted
    // apart, and a Model whose size cannot be turned into a parameter count
    // cannot be ranked by one — dropped rather than shown with a zero beside it.
    if (parameters === null) continue;

    recommendations.push({
      repo: candidate.repo,
      url: repoPage(candidate.repo),
      downloads: candidate.downloads,
      quant: quant.quant,
      bytes: quant.bytes,
      parameters,
      tokensPerSecond: request.bytesPerSecond / quant.bytes,
    });
  }

  if (request.rank === "intelligence") {
    // Parameters first, downloads only to break a tie. Download count is not
    // demoted to noise here — two 14B Models of equal size are separated by it —
    // but it never overtakes a difference in how much Model is on the disk.
    return recommendations
      .sort((a, b) => b.parameters - a.parameters || b.downloads - a.downloads)
      .slice(0, RECOMMENDATION_LIMIT);
  }

  // Downloads, because it is the one signal here that is somebody else's
  // judgement rather than this app's — and the Hub's ordering is stable and
  // current, which a curated table in source would not be.
  return recommendations
    .sort((a, b) => b.downloads - a.downloads)
    .slice(0, RECOMMENDATION_LIMIT);
}

/** One repository, measured. */
type Candidate = { repo: string; downloads: number; quants: QuantSize[] };

/**
 * Walks the Hub's listing, filters cheaply, then measures what survives.
 *
 * The order of those two steps is the whole cost argument. Measuring every
 * candidate costs one request each and there are hundreds; the parameter count
 * in the listing is free and is a lower bound on the size of any acceptable
 * quantisation, so a Model that cannot fit even at four bits is dropped before
 * anything is spent on it.
 *
 * Which twenty survive is where the two fits part company, and it is a larger
 * difference than the final sort. Ranked by downloads the window is filled with
 * the small Models the Hub is most used with; ranked by parameter count it is
 * filled with the largest that could be recommended at all. Both windows are
 * twenty requests, so the second costs exactly as much as the first and is the
 * only way the size fit can be anything other than a reordering.
 */
async function measureCandidates(budget: number, rank: Rank): Promise<Candidate[]> {
  const listing = await fetchJson(listingUrl());
  if (!Array.isArray(listing)) return [];

  const intelligence = rank === "intelligence";

  // The size fit asks "could this be recommended", not "could this run". Filtering
  // at the 4-bit floor admits the very large Models that are published only as
  // 2-bit and 3-bit files, which no fit will ever offer — twenty measurements spent
  // on repositories that are all rejected, and an empty answer on precisely the
  // hardware that could have had a good one. Filtering at the quality bar costs
  // the Models that publish nothing above Q4_K_S, which is a fair trade: this app
  // would not have recommended them anyway.
  const assumedBits = intelligence ? QUALITY_BAR_BITS : QUANT_FLOOR_BITS;

  const plausible: { repo: string; downloads: number; parameterCountBytes: number }[] = [];

  for (const entry of listing) {
    const read = readListingEntry(entry);
    if (read === null) continue;

    // The cheap filter. `gguf.total` over-states every Model by roughly the
    // quantisation ratio, so what survives is a set of Models that might fit —
    // not one that definitely does.
    if (roughSizeBytes(read.parameterCountBytes, assumedBits) > budget) continue;

    plausible.push(read);
  }

  plausible.sort((a, b) =>
    intelligence
      ? b.parameterCountBytes - a.parameterCountBytes || b.downloads - a.downloads
      : b.downloads - a.downloads,
  );

  return measureInParallel(plausible.slice(0, MEASURE_LIMIT));
}

/** The listing request: no query, quantised text-generation Models, most downloaded first. */
function listingUrl(): URL {
  const url = new URL(HUB);
  url.searchParams.set("filter", "gguf,text-generation");
  url.searchParams.set("sort", "downloads");
  url.searchParams.set("direction", "-1");
  url.searchParams.set("limit", "100");
  // The expansion carrying the parameter count. Without it the answer is a list
  // of names, and every candidate would have to be measured to be judged.
  url.searchParams.set("expand", "gguf");

  return url;
}

/** One listing entry, or null when it carries nothing this app can use. */
function readListingEntry(entry: unknown): { repo: string; downloads: number; parameterCountBytes: number } | null {
  if (typeof entry !== "object" || entry === null) return null;

  const record = entry as Record<string, unknown>;

  const id = record.id;
  if (typeof id !== "string" || id.trim().length === 0) return null;

  const gguf = record.gguf;
  if (typeof gguf !== "object" || gguf === null) return null;

  const total = (gguf as Record<string, unknown>).total;
  if (typeof total !== "number" || !Number.isFinite(total) || total <= 0) return null;

  const downloads = record.downloads;

  return {
    repo: id.trim(),
    downloads: typeof downloads === "number" ? downloads : 0,
    parameterCountBytes: total,
  };
}

/**
 * Measures a handful of repositories, a few at a time.
 *
 * Bounded on both axes deliberately. The count is bounded because each one costs
 * a request, and a reader who opened Settings should not cause ninety of them;
 * the concurrency is bounded because the Hub will start refusing a burst, and a
 * refused request is a Model missing from the list for no reason a reader could
 * act on.
 *
 * A repository that fails to measure is dropped rather than guessed at. There is
 * no partial answer available for a size, and a plausible-looking figure for a
 * Model nobody measured is the one thing this module must never produce.
 */
async function measureInParallel(candidates: { repo: string; downloads: number }[]): Promise<Candidate[]> {
  const measured: Candidate[] = [];

  for (let at = 0; at < candidates.length; at += CONCURRENCY) {
    const batch = candidates.slice(at, at + CONCURRENCY);

    const answers = await Promise.all(batch.map(async (candidate) => {
      const tree = await fetchJson(new URL(`https://huggingface.co/api/models/${candidate.repo}/tree/main?recursive=1`));
      const quants = readQuantSizes(tree);
      return quants.length > 0 ? { ...candidate, quants } : null;
    }));

    for (const answer of answers) {
      if (answer !== null) measured.push(answer);
    }
  }

  return measured;
}

/**
 * A GET with a timeout, returning parsed JSON or null.
 *
 * No `Authorization` header, deliberately. This endpoint is public, and the
 * reader may well have a Hugging Face token in their environment — sending it
 * here would put a Credential on a request this app does not control. The
 * single most damaging mistake available in this file, and the reason the
 * absence is commented rather than left to be noticed.
 */
async function fetchJson(url: URL): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      cache: "no-store",
      headers: { accept: "application/json" },
    });

    if (!response.ok) return null;

    return await response.json();
  } catch {
    // Offline, timed out, rate-limited, unparseable. All of it means the same
    // thing: this candidate is not known, and is left out.
    return null;
  } finally {
    clearTimeout(timer);
  }
}
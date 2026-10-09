"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { describeMachine, requestHardware, type HardwareAnswer } from "@/lib/hardware/hardware-request";
import {
  requestRecommendations,
  type Rank,
  type Recommendation,
  type RecommendationAnswer,
} from "@/lib/hardware/recommend-request";

/**
 * What this machine is, and what would run on it.
 *
 * The section answers a question the reader cannot otherwise answer: not which
 * Model is loaded, but which of the Models on Hugging Face would run well here.
 * That is why it takes no Endpoint — a reader asking what they could use is not
 * yet using anything, and the answer should not depend on which one the composer
 * happens to be pointed at.
 *
 * The speed is a **slider rather than a constant**, and that is the design
 * decision the whole section rests on. At 50 tokens a second on an M4 only
 * sub-2B Models qualify; at 20, a 4B does. A fixed threshold would silently
 * answer a question the reader did not ask, and on weaker hardware would answer
 * it with nothing at all. A slider shows the trade-off instead of picking a point
 * on it.
 *
 * The same budget answers **two fits**, and the tabs are what put them side by
 * side. Speed fit leads with pace; Intelligence fit leads with how much Model is
 * on the disk. They are not two feature switches over one list — they ask for
 * different candidates to be measured, because the twenty most-downloaded Models
 * on the Hub are small ones, and reordering those by size would be a list of
 * small Models in a different order. The slider serves both: dragged to its floor
 * the speed stops being the binding constraint, memory takes over, and
 * "intelligence over speed" becomes simply the largest Model this machine holds.
 *
 * The one request here that leaves the machine — the Hub — is made only when the
 * reader moves the slider or picks a fit, never on open, because a reader who came
 * here to change the Theme should not have caused a call to a third party.
 */

/** Where the slider starts, and the value the reader asked for. */
const DEFAULT_TOKENS_PER_SECOND = 50;

/** The slowest and fastest worth offering; below and above these nothing changes. */
const SLOWEST = 5;
const FASTEST = 200;

/** How long to wait after the slider settles before asking, so a drag is one request. */
const SETTLE_MS = 400;

/**
 * The two fits, and what each one admits.
 *
 * Said in the reader's terms on the note under the list rather than here, because
 * the note has room and the tab does not. `rank` is the closed set the route takes
 * as its enum, so the two cannot drift apart: adding a third fit here is a change
 * the route refuses until its schema is widened deliberately.
 */
const FITS: readonly { rank: Rank; label: string }[] = [
  { rank: "speed", label: "Speed fit" },
  { rank: "intelligence", label: "Intelligence fit" },
];

export function HardwareSection() {
  const [machine, setMachine] = useState<HardwareAnswer | null>(null);
  const [wanted, setWanted] = useState(DEFAULT_TOKENS_PER_SECOND);
  const [rank, setRank] = useState<Rank>("speed");
  const [answer, setAnswer] = useState<RecommendationAnswer | null>(null);
  const [asking, setAsking] = useState(false);

  // Which fit was showing last, so the effect below can tell a tab switch from a
  // slider drag — the two want very different timing.
  const shownRank = useRef<Rank>("speed");

  // The machine is local and fast, so it is read on open rather than asked for.
  // `system_profiler` is seconds on a loaded machine, which is why this shows
  // "Reading..." rather than pretending to know nothing yet.
  useEffect(() => {
    let current = true;
    void requestHardware().then((found) => {
      if (current) setMachine(found);
    });
    return () => {
      current = false;
    };
  }, []);

  const ask = useCallback((minTokensPerSecond: number, which: Rank) => {
    setAsking(true);
    void requestRecommendations(minTokensPerSecond, which)
      .then(setAnswer)
      .finally(() => setAsking(false));
  }, []);

  // Asked on mount as well as on change, because a section that says nothing
  // until something happens is a section a reader has to discover. The mount
  // case is the reader asking to see recommendations at all.
  useEffect(() => {
    // A tab switch is a discrete choice, not a drag: by the time the reader has
    // clicked it they have stopped moving, so there is nothing to wait for. The
    // slider is the opposite — dragging it across the range is a dozen requests
    // to a third party for an answer the reader was not going to stop on.
    const switching = shownRank.current !== rank;
    shownRank.current = rank;

    // A list ordered one way is not an answer to a question asked another way, so
    // it is dropped rather than left to fade. A speed-ranked list sitting under
    // "Intelligence fit" is briefly a list that is wrong about what it is.
    if (switching) setAnswer(null);

    const timer = setTimeout(() => ask(wanted, rank), switching ? 0 : SETTLE_MS);
    return () => clearTimeout(timer);
  }, [wanted, rank, ask]);

  return (
    <section aria-labelledby="hardware-heading" className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <span id="hardware-heading" className="hm-label w-16 shrink-0">
          Hardware
        </span>
        <p className="flex-1 font-mono text-sm text-ink-2" role="status">
          {machine === null ? "Reading this machine..." : describeMachineOrReason(machine)}
        </p>
      </div>

      <div
        role="tablist"
        aria-label="What to put first"
        // Structural hook rather than a styling one, for the reason recorded on
        // `file-menu.tsx`: a test that reads a class is pinned to the styling.
        className="ml-16 flex gap-4"
      >
        {FITS.map((fit) => {
          const chosen = fit.rank === rank;

          return (
            <button
              key={fit.rank}
              type="button"
              role="tab"
              aria-selected={chosen}
              data-rank={fit.rank}
              onClick={() => setRank(fit.rank)}
              className={`hm-label cursor-pointer pb-1 ${
                chosen ? "border-b-2 border-ink text-ink" : "border-b-2 border-transparent"
              }`}
            >
              {fit.label}
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-3">
        <label className="hm-label w-16 shrink-0" htmlFor="speed-fit">
          Speed
        </label>

        <input
          id="speed-fit"
          type="range"
          min={SLOWEST}
          max={FASTEST}
          step={5}
          value={wanted}
          // Not a controlled-throttled request: the label updates immediately
          // so the control feels connected to the finger, while the request
          // waits for the drag to settle.
          onChange={(event) => setWanted(Number(event.target.value))}
          aria-describedby="speed-fit-message"
          className="flex-1"
        />

        <span className="w-20 shrink-0 text-right font-mono text-xs text-ink-2">
          {wanted} tok/s
        </span>
      </div>

      <p id="speed-fit-message" className="hm-status">
        {sliderMeaning(wanted)}
      </p>

      {answer !== null && <AnswerList answer={answer} asking={asking} rank={rank} />}

      <p className="hm-status">{FIT_NOTES[rank]}</p>
    </section>
  );
}

/**
 * What the slider is asking for, in the reader's terms.
 *
 * Said in words because the number alone does not convey that it is a
 * requirement being placed on the answer. Fifty tokens a second reads as a
 * preference until you know nothing below it is offered at all.
 */
function sliderMeaning(tokensPerSecond: number): string {
  if (tokensPerSecond >= 100) return "Very fast. Only small Models will qualify.";
  if (tokensPerSecond >= 50) return "Quick enough that a Response feels immediate.";
  if (tokensPerSecond >= 20) return "Readable, with a pause before each answer.";
  return "Slow. Expect to wait, and expect fewer Models to qualify.";
}

/**
 * What is honest about each fit's ordering.
 *
 * Both leads concede the same thing about speed — nobody measured it on this
 * machine — and then differ on what the list is sorted by, because the two
 * signals are not the same kind of claim. Downloads are somebody else's
 * judgement; parameter count is this app's, and a proxy. Neither is quality, and
 * saying so once here is what keeps a reader from treating the top row as the
 * best Model on the Hub.
 */
const FIT_NOTES: Record<Rank, string> = {
  speed:
    "Speeds are estimated from this machine's memory bandwidth, not measured on it. Rankings come from Hugging Face downloads, which is popularity rather than quality.",
  intelligence:
    "Speeds are estimated from this machine's memory bandwidth, not measured on it. Rankings come from parameter count, which is a rough proxy for capability — more parameters is usually more capable, and sometimes much less so.",
};

/**
 * The machine, or the reason there is not one to describe.
 *
 * "No accelerator found" is shown rather than hidden. A reader who cannot tell
 * "this machine has no GPU" from "the probe failed" has been told nothing, and
 * the second is likelier on a machine whose tools answered nothing.
 */
function describeMachineOrReason(answer: HardwareAnswer): string {
  if (answer.status === "unavailable") return `Could not read this machine — ${answer.message}`;

  const described = describeMachine(answer.spec);
  if (described.length > 0) return described;

  return "No chip details found on this machine";
}

/** The answer, in whichever of its shapes arrived. */
function AnswerList({
  answer,
  asking,
  rank,
}: {
  answer: RecommendationAnswer;
  asking: boolean;
  rank: Rank;
}) {
  if ("status" in answer) {
    return (
      <p className="ml-16 text-xs text-muted" role="status">
        {answer.message}
      </p>
    );
  }

  if (!answer.applies) {
    // The refusal. Said plainly rather than as an empty list, because an empty
    // list here would read as "nothing suits this machine" — the opposite of
    // the truth, which is that the machine was never the right one to ask about.
    return (
      <p className="ml-16 text-xs text-muted" role="status">
        {answer.reason} These specs describe the machine this app runs on, so no fits are shown.
      </p>
    );
  }

  if (answer.reason !== null) {
    return (
      <p className="ml-16 text-xs text-muted" role="status">
        {answer.reason}
      </p>
    );
  }

  if (answer.recommendations.length === 0) {
    // The ceiling is what makes this answer explicable rather than merely
    // empty. On an M4 at 50 tokens a second it is under 2 GB, which is why only
    // very small Models appear there — and a reader told the speed they chose
    // and the consequence of it can decide whether to move the slider.
    const ceiling =
      answer.largestModelBytes === null
        ? null
        : ` At that speed a Model has to be under ${gib(answer.largestModelBytes)}.`;

    return (
      <p className="ml-16 text-xs text-muted" role="status">
        {asking
          ? "Looking..."
          : `Nothing on Hugging Face clears ${answer.minTokensPerSecond} tokens a second on this machine.${ceiling ?? ""} Lower the slider to see more.`}
      </p>
    );
  }

  return (
    <ul className="ml-16 flex flex-col gap-1.5" role="list">
      {answer.recommendations.map((item) => (
        <RecommendationRow key={item.repo} item={item} rank={rank} />
      ))}
    </ul>
  );
}

/**
 * One Model, and where to get it.
 *
 * The left column carries **whatever this fit is ordered by** — pace on one tab,
 * how much Model on the other — because that is where the reader's eye starts and
 * it is the figure that explains the position of the row. The other one is kept,
 * beside the size: a Model that is the most capable thing this machine can hold
 * is not a recommendation if it takes a minute to answer, and hiding the pace to
 * make the other tab look better would be the whole lie the note beneath is there
 * to prevent.
 *
 * The quantisation and its size come next because those are what the reader
 * actually downloads, and the two are not the same thing — the same Model has
 * eight sizes, and picking the wrong one costs gigabytes.
 *
 * The link goes to the repository page rather than to a file, because the page is
 * where the download button is and where the other quantisations are listed, so
 * a reader who wants a smaller or larger one can find it without coming back
 * here. Nothing is downloaded by the app: this is advice, not an installer.
 */
function RecommendationRow({ item, rank }: { item: Recommendation; rank: Rank }) {
  const leading = rank === "intelligence" ? billion(item.parameters) : `${Math.round(item.tokensPerSecond)} tok/s`;
  const trailing = rank === "intelligence" ? ` · ${Math.round(item.tokensPerSecond)} tok/s` : "";

  return (
    <li className="flex items-baseline gap-3 border-l-2 border-rule pl-3">
      {/* Wide enough for the largest figure this can draw. `672 tok/s` wrapped onto
          two lines at the narrower width the label column sets, which made a
          three-digit speed look like two separate readings. */}
      <span className="w-20 shrink-0 font-mono text-xs text-accent">{leading}</span>

      <a
        href={item.url}
        target="_blank"
        rel="noreferrer"
        className="min-w-0 flex-1 truncate font-mono text-xs text-ink underline decoration-rule underline-offset-2"
      >
        {item.repo}
      </a>

      <span className="shrink-0 font-mono text-xs text-muted">
        {gib(item.bytes)} {item.quant}
        {trailing}
      </span>
    </li>
  );
}

/** Bytes as the reader would say them. */
function gib(bytes: number): string {
  const value = bytes / 1024 ** 3;
  return value >= 10 ? `${Math.round(value)} GB` : `${value.toFixed(1)} GB`;
}

/**
 * Parameters as the reader would say them.
 *
 * The decimal is dropped as the number grows past the point where it carries
 * anything — `145B` and not `145.0B` — because on the largest Models that this
 * list will ever hold the tenth is noise occupying the space the size needs.
 */
function billion(parameters: number): string {
  const value = parameters / 1e9;

  if (value >= 100) return `${Math.round(value)}B`;
  if (value >= 10) return `${value.toFixed(0)}B`;
  if (value >= 1) return `${value.toFixed(1)}B`;
  return `${Math.round(parameters / 1e6)}M`;
}
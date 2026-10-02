import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { reviewExcerptRecords } from "../../lib/review-verdict.mjs";
import { excerptMetricLine, summarizeExcerpts } from "../../lib/review-truncation.mjs";
import { reworkMetricLine, summarizeRework } from "../../lib/rework-metrics.mjs";
import type { CritiqueGapState } from "./critique-gap-state.js";
import { readReviewFiles } from "./review-records.js";
import type { WorkerCard } from "../workers-types.js";

/**
 * The flow strip's reviewer and rework readings, over the finished cards.
 *
 * The strip already shows where time went (`flow-metrics.ts`, pure over the
 * ledger). This adds the two readings that need the *files* a card left behind —
 * its critique rounds and its review records — and it lives here rather than in
 * `flow-metrics.ts` because that function is pure and synchronous by contract,
 * and reading a card's workspace is neither. Keeping them apart is what stops a
 * board panel from growing async I/O into a ledger summary.
 *
 * Every line is produced by the same `lib/` owner the CLI and the card call, so
 * a fleet, a card and a terminal cannot say three different things about the
 * same number. The strip renders the strings; it does not format them.
 *
 * The aggregation is a sum, not a median of medians: a fleet's rework is how
 * many findings came back across the cards in scope, over how many passes those
 * cards were given. Per-card medians would be a second, quieter source of truth
 * for the same question — the mistake the wait breakdown already documents.
 */

type Deps = {
  bb: BbPluginApi;
  getCard: (cardId: string) => WorkerCard | undefined;
  critiqueGapState: (card: WorkerCard) => Promise<CritiqueGapState>;
  cardWorkspace: (card: WorkerCard) => Promise<{ path: string } | null>;
};

/** The strip's two lines, plus the counts behind them. */
export type FlowCoverage = {
  /** Rework across every card in scope: findings that came back, over passes. */
  rework: {
    cardsWithRounds: number;
    comparable: number;
    reworked: number;
    rate: number | null;
    descriptions: string[];
  };
  /** Reviewer coverage across every review recorded on those cards. */
  reviews: {
    counted: number;
    truncated: number;
    headCuts: number;
  };
  /** The rendered lines, or "" for either that has nothing to say. */
  reworkLine: string;
  coverageLine: string;
};

async function coverageFor(deps: Deps, card: WorkerCard) {
  const state = await deps.critiqueGapState(card).catch(() => null);
  const rework = summarizeRework(state?.matched ? state.critiqueRounds : []);
  // The review records are kept, not reduced to counts: the coverage owner
  // decides the mode breakdown and the line, and handing it a count instead
  // would make the fleet line say something the records do not support.
  const records = reviewExcerptRecords(
    await readReviewFiles(
      { bb: deps.bb, cardWorkspace: deps.cardWorkspace },
      card,
    ),
  );
  return {
    rounds: rework.rounds,
    reworked: rework.reworked,
    reworkedDescriptions: rework.reworkedDescriptions,
    records,
  };
}

/**
 * Build the flow strip's coverage readings for a set of finished card ids.
 *
 * Fail-soft on every card: a card whose workspace is gone, or whose reviews
 * directory cannot be listed, contributes nothing and is not an error. The
 * alternative — one unreadable card failing the whole board panel — would make
 * the metric less trustworthy, not more.
 */
export async function buildFlowCoverage(
  deps: Deps,
  cardIds: string[],
): Promise<FlowCoverage> {
  const cards = cardIds
    .map((cardId) => deps.getCard(cardId))
    .filter((card): card is WorkerCard => card !== undefined);
  const perCard = await Promise.all(cards.map((card) => coverageFor(deps, card)));

  // Rework is summed across cards, because a finding that came back on one card
  // is a finding that came back — the cards are not competing samples of one
  // population, they are the whole population in scope.
  const comparable = perCard.reduce((sum, card) => sum + Math.max(0, card.rounds - 1), 0);
  const reworked = perCard.reduce((sum, card) => sum + card.reworked, 0);
  const descriptions = perCard
    .flatMap((card) => card.reworkedDescriptions)
    .sort();
  const coverage = summarizeExcerpts(perCard.flatMap((card) => card.records));

  const reworkSummary = {
    rounds: perCard.reduce((sum, card) => sum + card.rounds, 0),
    comparable,
    reworked,
    rate: comparable > 0 ? reworked / comparable : null,
    reworkedDescriptions: descriptions,
  };
  return {
    rework: {
      cardsWithRounds: perCard.filter((card) => card.rounds > 0).length,
      comparable,
      reworked,
      rate: reworkSummary.rate,
      descriptions,
    },
    reviews: {
      counted: coverage.counted,
      truncated: coverage.truncated,
      headCuts: coverage.headCuts,
    },
    // Rendered by the owners the CLI and the card call, so a fleet, a card and
    // a terminal print the same sentence for the same number.
    reworkLine: reworkMetricLine(reworkSummary),
    coverageLine: excerptMetricLine(coverage),
  };
}

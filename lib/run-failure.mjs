// Why a card's newest host run failed, read as one fact for the board.
//
// The board already had a failure chip, and it meant one thing: the WORKER THREAD
// stopped (`errorActivityLabel` reads `activity === "error"` + `last_error`). A host
// Workflows run is a different subsystem with a different remedy — "Retry run"
// releases the stage hold (`lib/failed-run-gate.mjs`), which is not the same action
// as the worker's "Retry". That second failure was recorded correctly and rendered
// nowhere: `reconcileSimpleState` (`server/execution-reconcile-run.ts`) writes the
// `execution_runs` row, a trail comment and an auto-retry attempt, and never writes
// the card row. So the fact existed and the board could not show it.
//
// Four decisions this module exists to hold, each one a mistake this card made
// once and is now shaped against:
//
// 1. NEWEST RUN, NOT "A FAILED RUN EXISTS". A card accumulates a run for every
//    stage it passed, so an un-cleared "some run failed" badge would mark healthy
//    cards broken forever — and nothing in this plugin can delete the failed row to
//    clear it. That wedge is why `lib/failed-run-gate.mjs` was rewritten away from
//    that reading; this board signal must not rebuild it. A later success, a
//    retry in flight, or a cancellation all clear the badge honestly, because they
//    are all newer evidence.
//
// 2. `rowid DESC` IS LOAD-BEARING, NOT DECORATION. `listExecutionRuns` orders by
//    `created_at DESC` alone, two runs can share a millisecond, and SQLite promises
//    no order for a tie — so "newest" would be whatever the scan happened to yield.
//    `blockingFailedRun` carries the same clause for the same reason.
//
// 3. CARD-SCOPED, NOT STAGE-SCOPED. The stage-scoped derivation is right for the
//    ADVANCE GATE and wrong for the BOARD: a board badge that vanished the moment
//    the card moved on would be the opposite of "visible without opening it". This
//    is that derivation's sibling, not its replacement — same table, same ordering
//    discipline, different question.
//
// 4. TERMINALITY IS JUDGED ON THE RAW ROW. The tree holds two near-identically
//    named predicates with different argument shapes, and picking the wrong one
//    makes the `blocked` arm unreachable: `blocked` is not in `CARD_STATUSES`
//    (`lib/card-status.mjs`) and `readCardStatus` maps anything unknown to `draft`,
//    so the PROJECTED status can never be `blocked`. `isClaimTerminal(row.status)`
//    reads the raw row, which is what the sibling derivations in `server/cards.ts`
//    already receive. `cardIsTerminal` is the other one; do not use it here.
//
// The read is FAIL-SOFT, in the `stallCount` shape, and that is not defensive
// padding. Three board load paths swallow a rejected `listCards` into an empty card
// list (`explore-panel-state.ts:51`, `build-panel-state.ts:169`,
// `research-panel-state.ts:51`), so an unguarded throw here is not a chip-less board,
// it is NO board with no error message. A board that cannot answer about one card
// must still answer about the others.

import { BLOCKING_RUN_STATUS } from "./execution-run-ledger.mjs";
import { isClaimTerminal } from "./card-terminal.mjs";
import { truncateCause } from "./worker-failure.mjs";

/** The chip's label. One word is the whole vocabulary lesson: a RUN failed, not the worker. */
export const RUN_FAILURE_LABEL = "Run failed";

/** What the tile says when the row recorded no reason at all. Stated words, never an empty title, never an instruction. */
export const NO_RUN_REASON = "The host recorded no reason for this failure.";

/**
 * This plugin's OWN failure codes, in a reader's words.
 *
 * `error_code` is NOT a closed enum: `failureReason`
 * (`server/execution-reconcile-run.ts`) returns the host's `scriptError` verbatim
 * whenever the host supplies one, so free-form host text reaches this column. The
 * table therefore translates only the literals THIS plugin writes, and anything
 * else — an unmapped code, or a host's own sentence — passes through unchanged.
 * Inventing English for a code we do not own would be fabricating a diagnosis.
 *
 * The detail is truncated AFTER mapping, never before: a long host string cut at
 * 180 first could slice a mapped phrase in half.
 */
export const RUN_FAILURE_REASON_LABELS = Object.freeze({
  "native-start-timeout": "The host never confirmed the run started.",
  "native-start-failed": "The host could not start the run.",
  "native-unreachable": "The host stopped answering about this run.",
  "user-cancelled": "The run was cancelled.",
  "resumed-by-child": "A child run took this one over.",
  "resume-start-failed": "The host could not resume the run.",
  "invalid-interface-route": "The run's interface route was rejected.",
  "invalid-native-boundary": "The run's boundary was rejected.",
  // Added after the map shipped: the artifact-registration writer stores this
  // code, and without a row here the tile would print a raw slug. The test that
  // scans the writers for `errorCode:` literals is what found it.
  "artifact-registration-failed": "The run's artifacts could not be registered.",
});

/**
 * The raw newest-run failure for a card, or null.
 *
 * `{ errorCode } | null` — the RAW fact, deliberately. Formatting happens once, in
 * `runFailure`, so the wording is decided in a single place and the contract field
 * is literally what this module produced.
 */
export function lastRunFailure(db, cardId) {
  try {
    const row = db.prepare(
      "SELECT normalized_status, error_code FROM execution_runs "
      + "WHERE card_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1",
    ).get(cardId);
    if (!row || row.normalized_status !== BLOCKING_RUN_STATUS) return null;
    return { errorCode: row.error_code };
  } catch {
    return null;
  }
}

/**
 * The board signal for one card, or null when there is nothing to show.
 *
 * Takes the RAW row, not the projected card — that is what makes the terminal check
 * above reachable, and it matches `integrationPending(deps.db, row)` beside it.
 */
export function runFailure(db, row) {
  if (!row || isClaimTerminal(row.status)) return null;
  const newest = lastRunFailure(db, row.id);
  if (!newest) return null;
  return {
    label: RUN_FAILURE_LABEL,
    detail: runFailureDetail(newest.errorCode),
  };
}

/**
 * The one sentence the tile may carry: the reason, or a stated reason for its
 * absence. Never an instruction to go and look — the board names, the detail
 * explains.
 */
export function runFailureDetail(errorCode) {
  const raw = typeof errorCode === "string" ? errorCode.trim() : "";
  if (!raw) return NO_RUN_REASON;
  const mapped = RUN_FAILURE_REASON_LABELS[raw] ?? raw;
  return truncateCause(mapped) ?? NO_RUN_REASON;
}

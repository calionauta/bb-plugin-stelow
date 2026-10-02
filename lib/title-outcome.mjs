/**
 * Closed outcome taxonomy for the card-title burst.
 *
 * Every exit from the title path resolves to exactly one of these values, so a
 * failure is countable instead of inferred. Three indistinguishable causes used
 * to look identical from outside AND left no record; this module is the
 * instrument that separates them. It is deliberately closed — free text would
 * not aggregate, and aggregation is the entire point.
 *
 * The `.d.mts` sibling is not optional: tsconfig sets no `allowJs`, so
 * TypeScript cannot see a `.mjs` module's types without it.
 */

/** The complete set. Adding a value here is a deliberate, reviewed change. */
export const TITLE_OUTCOMES = Object.freeze([
  "delivered",
  "delivered_after_retry",
  "card_gone",
  "spawn_failed",
  "thread_error",
  "timed_out",
  "no_output",
  "invalid_output",
  "renamed_mid_burst",
  "archived_mid_burst",
  "internal_error",
]);

const OUTCOME_SET = new Set(TITLE_OUTCOMES);

/** Outcomes that leave a trail comment. The rest go to the daemon log. */
const UNRECORDABLE = new Set(["card_gone", "renamed_mid_burst", "archived_mid_burst"]);

/**
 * Does this outcome leave a comment on the card?
 *
 * `card_gone` cannot: `comments.card_id` is a foreign key with
 * `ON DELETE CASCADE` (server/core-migrations.ts:59), so a record for a deleted
 * card either throws or is cascaded away. The other two would be noise — a
 * human just named the card, and `addCardComment` refuses archived cards.
 */
export function isRecordable(outcome) {
  return OUTCOME_SET.has(outcome) && !UNRECORDABLE.has(outcome);
}

/**
 * The completion classification, status-first.
 *
 * `waitForThread` returns `timedOut: poll === polls - 1`, which is ALSO true
 * when the final poll observes `failed`/`error` — so an errored thread is
 * indistinguishable from an exhausted budget by that flag alone. Checking
 * `timedOut` first would fire the retry on a thread that errored; the status is
 * the honest signal.
 */
function classifyCompletion({ status, timedOut }) {
  if (status === "failed" || status === "error") return "thread_error";
  if (timedOut) return "timed_out";
  return null;
}

/**
 * Resolve the title path's exit to exactly one taxonomy value.
 *
 * The order of the checks IS the contract: status before budget, empty output
 * before validation (so `no_output` is reachable rather than swallowed by
 * `invalid_output`), and the live-card reads last so a card that vanished is
 * never blamed for producing junk.
 */
export function classifyTitleOutcome({
  spawned = false,
  completion = null,
  output = "",
  validated = null,
  live = null,
  originalTitle = null,
  archived = false,
  threw = false,
} = {}) {
  if (threw) return "internal_error";
  if (!live) return "card_gone";
  if (archived) return "archived_mid_burst";
  // The rename check precedes completion deliberately. A human who renamed a
  // card mid-burst must win even when the burst also timed out — classifying
  // the completion first would let a retry overwrite their name.
  if (originalTitle !== null && live.title !== originalTitle) return "renamed_mid_burst";
  if (!spawned) return "spawn_failed";
  const fromCompletion = classifyCompletion(completion ?? {});
  if (fromCompletion) return fromCompletion;
  // Empty output is its own value: a thread that ended cleanly with nothing is
  // not the same defect as a thread that answered with something unusable.
  if (typeof output !== "string" || output.trim().length === 0) return "no_output";
  if (!validated || !validated.ok || !validated.name) return "invalid_output";
  return "delivered";
}

/** Why a preset ran, in the words the reader needs to act on it. */
function presetClause(presetName, presetSource) {
  const label = presetSource === "band" ? `${presetName} (generation preset unset)` : presetName;
  return `on the ${label} preset`;
}

const NEXT_MOVE = "Rename inline from the card header if you want a name now.";

/**
 * The single trail line. One sentence naming cause, the preset that actually
 * ran, the retry state, and the next move — in that order, so a reader learns
 * one rule: a comment on a burst-titled card means the burst did not land.
 */
export function titleOutcomeComment(outcome, { presetName = "unknown", presetSource = null, retried = false } = {}) {
  if (!isRecordable(outcome)) return null;
  const preset = presetClause(presetName, presetSource);
  const lines = {
    delivered_after_retry: `Title burst timed out on the first attempt ${preset}; the retry landed a title. Recorded so the failure rate stays countable.`,
    spawn_failed: `Title burst did not start ${preset} — the spawn was refused. No retry applies to this cause. ${NEXT_MOVE}`,
    thread_error: `Title burst ended in error ${preset}. No retry applies to this cause. ${NEXT_MOVE}`,
    timed_out: `Title burst did not land — timed out ${preset}${retried ? " after one retry" : ""}. ${NEXT_MOVE}`,
    no_output: `Title burst finished ${preset} without returning a title. No retry applies to this cause. ${NEXT_MOVE}`,
    invalid_output: `Title burst returned something unusable ${preset}. No retry applies to this cause. ${NEXT_MOVE}`,
    internal_error: `Title burst hit an internal error ${preset}. The record itself may be incomplete. ${NEXT_MOVE}`,
    delivered: null,
    card_gone: null,
    renamed_mid_burst: null,
    archived_mid_burst: null,
  };
  return lines[outcome] ?? null;
}

/** Only a timeout is worth a second attempt. */
export function isRetryable(outcome) {
  return outcome === "timed_out";
}

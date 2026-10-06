/**
 * Why a failed run was NOT retried, as a fact the card can show.
 *
 * The auto-retry is fail-soft on purpose — a launch refusal means "stay parked",
 * never "fail the pass" — but "stay parked" was implemented as four bare
 * `return idle` statements, and a card that parks without saying so is the
 * phantom wait this project's rules forbid: the run failed, nothing retried it,
 * and the card went on looking like work in progress.
 *
 * Measured on the live database: five runs failed with "the recipe produced no
 * task outputs" and every one of them reached here with the card ALREADY on a
 * later stage (`scope` -> `audit`), so the stage guard refused all five and
 * reported none of them. `auto_retry_count` was 0 on all 54 rows, which is what a
 * silent refusal looks like from the outside: indistinguishable from "no retry
 * was ever applicable".
 *
 * So the decision is computed here, in one pure function, and every refusal
 * carries the reason and the exit. The module is `lib/` rather than the handler
 * because the rule is what needs testing — the handler's only job is to render
 * the verdict and record it.
 */

/** Every reason the host may decline to retry a failed run. The order is the
 * order the checks run, so the first match is the one reported. */
export const RETRY_REFUSALS = Object.freeze([
  "not-retryable: nothing was proved to have been skipped",
  "card-gone",
  "card-archived",
  "card-moved-on: the card advanced past the failed stage, so re-running its recipe would overwrite newer work",
  "retry-budget-spent: one automatic attempt per chain is the limit",
  "launch-refused",
  "launch-reported-no-run",
]);

/**
 * Whether this failed run is eligible for a host-driven retry, and if not, which
 * refusal applies.
 *
 * `shouldAutoRetryRun` answers only the error-code and budget half; this answers
 * the whole question, because the stage guard was the one that refused five real
 * runs and it lived outside the tested rule. Keeping the two apart would leave the
 * silent path exactly where it was.
 *
 * A refusal that names no exit is a deadlock with a good error message, so every
 * refusal below carries one:
 *
 *   - nothing proved          -> a person decides; Retry run is available
 *   - card gone / archived    -> nothing to do; the archived card is terminal
 *   - card moved on           -> nothing to do; the newer stage's work stands
 *   - budget spent            -> the card parks and asks; Retry run is available
 *   - launch refused / no run -> the launch caller already reported it
 */
export function retryDecision({ errorCode, autoRetryCount, cardStage, runStage, cardExists, cardArchived }) {
  if (typeof errorCode !== "string" || errorCode.trim() !== "the recipe produced no task outputs") {
    // Not a host-retry case at all, so there is nothing to record here: the caller
    // already wrote a failure trail line naming the reason and saying the card
    // remains available for retry. A second line from this module would state the
    // same fact twice, which is the duplication this project keeps paying for.
    return { retry: false, recordable: false, reason: RETRY_REFUSALS[0], exit: "a person decides from the failed run's trail; Retry run stays available" };
  }
  if (!cardExists) {
    return { retry: false, recordable: false, reason: "card-gone", exit: "nothing to retry — the card this run belonged to no longer exists" };
  }
  if (cardArchived) {
    return {
      retry: false,
      recordable: true,
      reason: "card-archived",
      exit: "nothing to retry — the card is archived, which is terminal to every automated path",
    };
  }
  if (cardStage !== runStage) {
    return {
      retry: false,
      recordable: true,
      reason: "card-moved-on: the card advanced past the failed stage, so re-running its recipe would overwrite newer work",
      exit: `nothing to retry — the card is now on ${cardStage} and that work stands; the failed run's trail records what did not happen`,
    };
  }
  const used = Number.isInteger(autoRetryCount) ? autoRetryCount : 0;
  if (used >= 1) {
    return {
      retry: false,
      recordable: true,
      reason: "retry-budget-spent: one automatic attempt per chain is the limit",
      exit: "the card parks and asks; Retry run stays available for a person to decide",
    };
  }
  return { retry: true, recordable: false, reason: null, exit: null };
}

/**
 * The trail line a refusal leaves, or `null` when the retry is proceeding (the
 * proceeding path leaves its own, different line).
 *
 * Silent means "no record on the card", not "no log output": a refusal that only
 * reaches a log file is invisible to the person looking at the card, which is the
 * person the record exists for.
 */
export function refusalRecord({ reason, exit, recipeId, runId, recordable = true }) {
  if (!reason || !recordable) return null;
  return `Native ${recipeId} produced no task outputs and the host did NOT retry it (${reason}). `
    + `Exit: ${exit} Previous run ${runId}.`;
}

/** Whether a refusal is worth an inbox event. A machine-noise refusal (the card
 * moved on, the card is gone) resolves itself and must not page anyone; a refusal
 * that leaves a person with a decision does. */
export function refusalNeedsAttention(reason) {
  if (!reason) return false;
  return reason.startsWith("retry-budget-spent") || reason.startsWith("not-retryable") || reason === "launch-refused";
}

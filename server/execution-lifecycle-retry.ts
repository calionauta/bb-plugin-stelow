/**
 * The retry rule — the door in the failed-run gate.
 *
 * A gate with no exit is a trap, so the refusal in `lib/failed-run-gate.mjs`
 * ("Retry run to try it again") is only honest if this exists. It does, and it
 * is deliberately thin: a retry is a fresh run of the same recipe at the same
 * stage, started through the SAME launch rule every other start uses
 * (`startNativeStageForCard`), so it inherits that rule's refusals — unknown
 * recipe, wrong stage, a card that already owns a live run, a host without the
 * capability — instead of growing a second set of its own.
 *
 * The failed run is left exactly as it is. Terminal states accept no further
 * transitions, and rewriting history to make a retry look tidy would mean the
 * card could no longer show what actually happened. What a retry does is add a
 * NEWER run for the same stage, and the gate reads the newest run for the
 * stage — so the hold releases the moment the retry starts, and re-tightens by
 * itself if the retry fails too. Nothing to clear, nothing to reconcile.
 */
import { getExecutionRun } from "../lib/execution-run-ledger.mjs";
import { isArchivedCard } from "../lib/worker-action-policy.mjs";
import { stageLabel as vocabularyStageLabel } from "../lib/workflow-vocabulary.mjs";
import type { LifecycleRuleDeps } from "./execution-lifecycle-types.js";

export type RetryDeps = Pick<
  LifecycleRuleDeps,
  "db" | "getCard" | "native" | "logComment" | "publishCard"
>;

export type RetryResult = { ok: boolean; runId: string | null; error: string | null };

/** Only a run that stopped can be tried again. A live one is already working. */
const RETRYABLE = ["failed", "cancelled"];

const STATE_LABELS: Record<string, string> = {
  queued: "queued",
  running: "running",
  needs_input: "waiting on a decision",
  succeeded: "succeeded",
  failed: "failed",
  cancelled: "cancelled",
};

export function createLifecycleRetrier(deps: RetryDeps) {
  return {
    retryExecutionRun: ({ runId }: { runId: string }) => retryExecutionRun(deps, runId),
  };
}

export async function retryExecutionRun(
  deps: RetryDeps,
  runId: string,
): Promise<RetryResult> {
  const run = getExecutionRun(deps.db, runId);
  if (!run) return { ok: false, runId: null, error: "Execution run not found." };
  if (!RETRYABLE.includes(run.normalizedStatus)) {
    return {
      ok: false,
      runId: null,
      error: `This run is ${stateLabel(run.normalizedStatus)}, so there is nothing to retry.`
        + (run.normalizedStatus === "succeeded" ? " It already finished." : " It is still working."),
    };
  }
  const card = deps.getCard(run.cardId);
  if (!card) return { ok: false, runId: null, error: "The card for this run no longer exists." };
  if (isArchivedCard(card)) {
    return { ok: false, runId: null, error: "This card is archived, so its runs cannot be retried." };
  }
  // The stage the retry runs at is the CARD's stage, not the run's recorded
  // one. A card that moved on since the run failed has already answered the
  // question this run failed to answer, and re-running the old stage's recipe
  // would write that stage's artifacts over work the card has since done.
  if (card.stage !== run.stage) {
    return {
      ok: false,
      runId: null,
      error: `This run belongs to ${stageLabel(run.stage)}, but the card is at ${stageLabel(card.stage)}.`
        + " Reopen that stage to try it again.",
    };
  }
  const started = await deps.native.startNativeStageForCard(
    card,
    run.recipeId,
    { prompt: card.prompt },
    card.stage,
  );
  if (!started.run) {
    return { ok: false, runId: null, error: started.error ?? "Unable to retry the native run." };
  }
  deps.logComment(
    card.id,
    started.run.id,
    `Retrying the ${run.recipeId} run that failed at ${stageLabel(run.stage)} (${run.id}).`,
  );
  deps.publishCard(card.id);
  return { ok: true, runId: started.run.id, error: null };
}

/** The reader's word for a run state. Never the raw enum. */
function stateLabel(status: string): string {
  return STATE_LABELS[status] ?? status;
}

/** The reader's word for a stage — the same one the card already uses. */
function stageLabel(stage: string): string {
  return vocabularyStageLabel(stage);
}

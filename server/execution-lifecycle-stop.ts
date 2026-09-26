/**
 * The stop rule. Two ways a run ends because something else ended first: the
 * user cancels one run, or the card stops owning a run at all — archived,
 * completed, or gone — and every run still open on it has to be closed on the
 * host too, not just in the database. A stop that only writes the row leaves a
 * workflow burning tokens against a card nobody is watching.
 */
import {
  getExecutionRun,
  listExecutionRuns,
  transitionExecutionRun,
  type ExecutionRun,
} from "../lib/execution-run-ledger.mjs";
import type { LifecycleRuleDeps } from "./execution-lifecycle-types.js";

export type StopDeps = Pick<
  LifecycleRuleDeps,
  "db" | "native" | "logComment" | "publishCard"
>;

export type CancelResult = { ok: boolean; run: ExecutionRun | null; error: string | null };

const LIVE_STATES = ["queued", "running", "needs_input"];
const TERMINAL_STATES = ["succeeded", "failed", "cancelled"];

export function createLifecycleStopper(deps: StopDeps) {
  return {
    cancelExecutionRun: ({ runId }: { runId: string }) => cancelExecutionRun(deps, runId),
    stopOwned: (cardId: string, reason: string) => stopOwned(deps, cardId, reason),
  };
}

export async function cancelExecutionRun(
  deps: StopDeps,
  runId: string,
): Promise<CancelResult> {
  const run = getExecutionRun(deps.db, runId);
  if (!run) return { ok: false, run: null, error: "Execution run not found." };
  if (TERMINAL_STATES.includes(run.normalizedStatus)) return { ok: true, run, error: null };
  const error = await cancelRemoteRun(deps, run);
  if (error) return { ok: false, run, error };
  const cancelled = transitionExecutionRun(deps.db, run.id, "cancelled", { errorCode: "user-cancelled" });
  deps.logComment(run.cardId, run.id, `Native ${run.recipeId} run cancelled by the user.`);
  deps.publishCard(run.cardId);
  return { ok: true, run: cancelled, error: null };
}

/**
 * False when the host refused at least one cancellation: the caller uses it to
 * know the card still has a live run, which is why a partial stop is reported
 * rather than swallowed.
 */
export async function stopOwned(
  deps: StopDeps,
  cardId: string,
  reason: string,
): Promise<boolean> {
  const active = listExecutionRuns(deps.db, cardId)
    .filter((run) => LIVE_STATES.includes(run.normalizedStatus));
  let stopped = true;
  for (const run of active) {
    const error = await cancelRemoteRun(deps, run);
    if (error) {
      stopped = false;
      continue;
    }
    transitionExecutionRun(deps.db, run.id, "cancelled", { errorCode: reason });
    deps.logComment(run.cardId, run.id, `Native ${run.recipeId} run cancelled: ${reason}.`);
  }
  return stopped;
}

async function cancelRemoteRun(deps: StopDeps, run: ExecutionRun): Promise<string | null> {
  if (run.adapter !== "bb-workflows" || !run.runId) return null;
  try {
    await deps.native.adapterFor(run).cancel({ runId: run.runId });
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : "Unable to stop native workflow.";
  }
}

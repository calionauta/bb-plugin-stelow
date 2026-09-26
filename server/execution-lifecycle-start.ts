/**
 * The start rule and the one question the rest of the plugin asks about it.
 * Starting is mostly refusal — no card, archived card, a card that already owns
 * a run — and each refusal names what the user can do next rather than failing
 * silently. `keepsCardRunning` is the other half: whether a card with an open
 * native run must stay alive, which is the only reason a card is not allowed to
 * complete while its run is still open.
 */
import { activeExecutionRun, type ExecutionRun } from "../lib/execution-run-ledger.mjs";
import { isArchivedCard } from "../lib/worker-action-policy.mjs";
import type { LifecycleRuleDeps, StartContext } from "./execution-lifecycle-types.js";
import type { WorkerCard } from "./workers-types.js";

export type StartDeps = Pick<
  LifecycleRuleDeps,
  "db" | "getCard" | "logComment" | "native" | "publishCard"
>;

export type StartResult = { ok: boolean; run: ExecutionRun | null; error: string | null };

export function createLifecycleStarter(deps: StartDeps) {
  return {
    startExecutionRun: ({
      cardId,
      recipeId,
      context,
    }: {
      cardId: string;
      recipeId: string;
      context: StartContext;
    }) => startExecutionRun(deps, cardId, recipeId, context),
    keepsCardRunning: (cardId: string, openQuestionCount: number) =>
      keepsCardRunning(deps, cardId, openQuestionCount),
  };
}

export async function startExecutionRun(
  deps: StartDeps,
  cardId: string,
  recipeId: string,
  context: StartContext,
): Promise<StartResult> {
  const card = deps.getCard(cardId);
  if (!card) return { ok: false, run: null, error: "Card not found." };
  if (isArchivedCard(card)) return { ok: false, run: null, error: "This card is archived." };
  const result = await deps.native.startNativeStageForCard(card, recipeId, context);
  if (result.run) {
    deps.logComment(cardId, result.run.id, `Native ${recipeId} run started${result.run.runId ? ` (${result.run.runId})` : ""}.`);
    deps.publishCard(cardId);
  }
  return result;
}

/**
 * A run that is queued or running keeps the card alive outright. A run waiting
 * on a boundary only does while nothing else is asking the user something:
 * a card with an open question is a card the user is already in.
 */
export function keepsCardRunning(
  deps: StartDeps,
  cardId: string,
  openQuestionCount: number,
): boolean {
  const run = activeExecutionRun(deps.db, cardId);
  if (!run) return false;
  if (["queued", "running"].includes(run.normalizedStatus)) return true;
  return run.normalizedStatus === "needs_input" && openQuestionCount === 0;
}

/**
 * The start rule. Starting is mostly refusal — no card, archived card, a card
 * that already owns a run — and each refusal names what the user can do next
 * rather than failing silently.
 *
 * Whether a card with an open run must stay alive is NOT decided here. It was,
 * and it was never called; the rule now lives in `lib/native-run.mjs` with the
 * sentence it derives, and the sync loop applies it.
 */
import type { ExecutionRun } from "../lib/execution-run-ledger.mjs";
import { isArchivedCard } from "../lib/worker-action-policy.mjs";
import type { LifecycleRuleDeps, StartContext } from "./execution-lifecycle-types.js";

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
 *
 * This rule moved to `lib/native-run.mjs` and is now applied by the sync loop,
 * which is the only place that could act on it. It used to sit here, exported
 * through the lifecycle facade, and called by nothing — so every card running a
 * multi-hour workflow went idle, was nudged, and parked with a Resume button
 * for work already in flight. The definition was never in doubt; only the
 * caller was missing.
 */

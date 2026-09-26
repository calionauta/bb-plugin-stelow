/**
 * The sweep rules: the two passes a reconcile makes over the whole board. One
 * repairs the runs already recorded — including stopping runs whose card has
 * gone away, which is the one repair with no card to publish to. The other
 * starts the run a card is eligible for and does not yet own, so a card whose
 * host run was lost picks its work back up without a human.
 */
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { listExecutionRuns } from "../lib/execution-run-ledger.mjs";
import { isArchivedCard } from "../lib/worker-action-policy.mjs";
import type { ReconcileStopper } from "./execution-reconcile-deps.js";
import type { ExecutionNative } from "./execution-native.js";
import type { WorkerCard } from "./workers-types.js";

type Db = ReturnType<BbPluginApi["storage"]["database"]>;

export type SweepDeps = {
  db: Db;
  getCard: (cardId: string) => WorkerCard | undefined;
  cardWorkspace: (card: WorkerCard) => Promise<{ path: string } | null>;
  publishCard: (cardId: string) => void;
  native: ExecutionNative;
  lifecycle: ReconcileStopper;
  run: { reconcileOne: (runId: string) => Promise<unknown> };
};

const LIVE_STATES = ["queued", "running", "needs_input"];

export function createReconcileSweep(deps: SweepDeps) {
  return {
    reconcileRuns: () => reconcileRuns(deps),
    reconcileStageEntries: () => reconcileStageEntries(deps),
  };
}

export async function reconcileRuns(deps: SweepDeps): Promise<void> {
  const cards = deps.db.prepare(
    "SELECT DISTINCT card_id FROM execution_runs WHERE normalized_status IN ('queued','running','needs_input')",
  ).all() as Array<{ card_id: string }>;
  for (const { card_id: cardId } of cards) {
    const card = deps.getCard(cardId);
    if (!card || isArchivedCard(card)) {
      await deps.lifecycle.stopOwned(cardId, "origin-unavailable");
      continue;
    }
    const active = listExecutionRuns(deps.db, cardId)
      .filter((entry) => LIVE_STATES.includes(entry.normalizedStatus));
    for (const run of active) await deps.run.reconcileOne(run.id);
  }
}

export async function reconcileStageEntries(deps: SweepDeps): Promise<void> {
  const cards = deps.db.prepare(
    "SELECT id FROM cards WHERE worker_thread_id IS NOT NULL AND status NOT IN ('completed','archived','blocked')",
  ).all() as Array<{ id: string }>;
  for (const { id } of cards) {
    const card = deps.getCard(id);
    if (!card?.worker_thread_id) continue;
    const workspace = await deps.cardWorkspace(card).catch(() => null);
    if (!workspace?.path) continue;
    const route = await deps.native.resolveStageExecutionRoute(card, card.stage, workspace.path);
    if (!route || route.route.mode === "refused") continue;
    if (route.route.mode === "coordinator-sequential") {
      deps.native.recordCoordinatorSequentialRoute(card.id, card.stage, route.recipeId, route.route);
      deps.publishCard(card.id);
      continue;
    }
    const existing = listExecutionRuns(deps.db, card.id)
      .some((run) => run.stage === card.stage && run.recipeId === route.recipeId);
    if (existing) continue;
    const started = await deps.native.startNativeStageForCard(
      card,
      route.recipeId,
      { prompt: card.prompt },
      card.stage,
    ).catch(() => null);
    if (started?.run) deps.publishCard(card.id);
  }
}

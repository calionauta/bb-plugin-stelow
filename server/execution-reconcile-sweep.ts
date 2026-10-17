/**
 * The sweep rules: the two passes a reconcile makes over the whole board. One
 * repairs the runs already recorded — including stopping runs whose card has
 * gone away, which is the one repair with no card to publish to. The other
 * observes stage entries a card is eligible for but does not yet own, and
 * says so on the card: the reconciler never starts work on its own, because
 * an auto-start inside a periodic sweep races every explicit start and births
 * duplicate runs the ledger then has to explain.
 */
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { listExecutionRuns } from "../lib/execution-run-ledger.mjs";
import { isArchivedCard } from "../lib/worker-action-policy.mjs";
import { STAGE_BY_ID } from "../lib/workflow-vocabulary.mjs";
import type { ReconcileStopper } from "./execution-reconcile-deps.js";
import type { ExecutionNative } from "./execution-native.js";
import type { WorkerCard } from "./workers-types.js";

type Db = ReturnType<BbPluginApi["storage"]["database"]>;

export type SweepDeps = {
  db: Db;
  getCard: (cardId: string) => WorkerCard | undefined;
  cardWorkspace: (card: WorkerCard) => Promise<{ path: string } | null>;
  logComment: (cardId: string, targetId: string, body: string) => void;
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
    // Ledger first: a card that already owns a run for its stage needs no
    // further attention from this pass.
    const recipeId = (STAGE_BY_ID as Record<string, { execution?: { recipe?: string } }>)[
      card.stage
    ]?.execution?.recipe;
    if (!recipeId) continue;
    const owned = listExecutionRuns(deps.db, card.id)
      .some((run) => run.stage === card.stage && run.recipeId === recipeId);
    if (owned) continue;
    // Observer only: record the gap on the card and publish it, but never
    // resolve a route or start a run. Starting here raced explicit starts —
    // the sweep and the human each birthed a run for the same stage — and a
    // periodic pass must not spend the card's single execution slot.
    try {
      deps.logComment(
        card.id,
        card.stage,
        `Reconcile observed no ${recipeId} run for stage ${card.stage}; no run was started automatically. Start one explicitly to proceed.`,
      );
    } catch {
      /* the observation is owed, never load-bearing */
    }
    try {
      deps.publishCard(card.id);
    } catch {
      /* publishing never fails the pass */
    }
  }
}

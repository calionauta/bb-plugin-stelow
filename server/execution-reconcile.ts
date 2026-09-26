import { createArtifactReconciler } from "./execution-reconcile-artifacts.js";
import { createBoundaryReconciler } from "./execution-reconcile-boundary.js";
import type { CardNotifier, ReconcileDeps } from "./execution-reconcile-deps.js";
import { createReconcileSweep } from "./execution-reconcile-sweep.js";
import { createRunReconciler } from "./execution-reconcile-run.js";
import type { WorkerCard } from "./workers-types.js";

/**
 * The reconciler is a composition root, not a rule. It owns the in-flight guard
 * and the wiring, and nothing else: the boundary, artifact, run and sweep rules
 * live in their own modules and take the slice of the dependencies they use, so
 * a rule can be read, and changed, without reading the whole reconcile pass. The
 * pass itself is one sentence — repair what is recorded, then start what is owed.
 */
export function createExecutionReconcile(deps: ReconcileDeps) {
  let inFlight = false;
  const { run, sweep } = wireReconcileRules(deps);

  async function reconcile(): Promise<void> {
    if (inFlight) return;
    inFlight = true;
    try {
      await sweep.reconcileRuns();
      await sweep.reconcileStageEntries();
    } finally {
      inFlight = false;
    }
  }

  return {
    reconcile,
    reconcileOne: run.reconcileOne,
    handlers: {
      executionRunStatus: async ({ runId }: { runId: string }) => run.reconcileOne(runId),
    },
  };
}

function wireReconcileRules(deps: ReconcileDeps) {
  const notifier: CardNotifier = {
    sendToCard(card: WorkerCard, text: string): void {
      if (!card.worker_thread_id) return;
      void deps.bb.sdk.threads.send({
        threadId: card.worker_thread_id,
        mode: "auto",
        input: [{ type: "text", text, mentions: [] }],
      }).catch(() => undefined);
    },
  };
  const boundary = createBoundaryReconciler({
    db: deps.db,
    randomId: deps.randomId,
    fetchPendingQuestions: deps.fetchPendingQuestions,
    logComment: deps.logComment,
    notify: notifier,
  });
  const artifacts = createArtifactReconciler({
    db: deps.db,
    bb: deps.bb,
    logComment: deps.logComment,
    notify: notifier,
  });
  const run = createRunReconciler({
    db: deps.db,
    now: deps.now,
    getCard: deps.getCard,
    logComment: deps.logComment,
    publishCard: deps.publishCard,
    native: deps.native,
    dispatch: {
      reconcileBoundary: boundary.reconcileBoundary,
      reconcileArtifacts: artifacts.reconcileArtifacts,
    },
  });
  const sweep = createReconcileSweep({
    db: deps.db,
    getCard: deps.getCard,
    cardWorkspace: deps.cardWorkspace,
    publishCard: deps.publishCard,
    native: deps.native,
    lifecycle: deps.lifecycle,
    run,
  });
  return { run, sweep };
}

export type ExecutionReconcile = ReturnType<typeof createExecutionReconcile>;
export type { ReconcileDeps, ReconcileResult } from "./execution-reconcile-deps.js";

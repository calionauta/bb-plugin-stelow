import { createArtifactReconciler } from "./execution-reconcile-artifacts.js";
import { createBoundaryReconciler } from "./execution-reconcile-boundary.js";
import type { CardNotifier, ReconcileDeps } from "./execution-reconcile-deps.js";
import { createReconcileSweep } from "./execution-reconcile-sweep.js";
import { createRunReconciler } from "./execution-reconcile-run.js";
import { isDatabaseClosedError } from "../lib/sqlite-errors.mjs";
import type { WorkerCard } from "./workers-types.js";

/**
 * The reconciler is a composition root, not a rule. It owns the in-flight guard
 * and the wiring, and nothing else: the boundary, artifact, run and sweep rules
 * live in their own modules and take the slice of the dependencies they use, so
 * a rule can be read, and changed, without reading the whole reconcile pass. The
 * pass itself is one sentence — repair what is recorded, start what is owed, then
 * ask the forge whether what still looks owed already landed.
 */
export function createExecutionReconcile(deps: ReconcileDeps) {
  let inFlight = false;
  let { run, sweep } = wireReconcileRules(deps);

  async function reconcile(): Promise<void> {
    if (inFlight) return;
    inFlight = true;
    try {
      await sweep.reconcileRuns();
      await sweep.reconcileStageEntries();
      // Last, optional, and unable to fail the pass: ask the forge whether a
      // card whose ledger still says "owed" has in fact already landed.
      await deps.reconcilePublications?.().catch(() => undefined);
    } catch (error) {
      if (!isDatabaseClosedError(error)) throw error;
      // The captured handle died — on a reload the new load owns a new
      // handle, but this pass (or a surviving timer) still holds the old one.
      // Rebuild against a live handle so the next pass proceeds; this pass
      // resolves because a dead handle could conclude nothing truthful.
      reportClosedHandle(deps, error);
      const rewired = rewireRules(deps);
      if (rewired) ({ run, sweep } = rewired);
    } finally {
      inFlight = false;
    }
  }

  return {
    reconcile,
    reconcileOne: (runId: string) => run.reconcileOne(runId),
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

/**
 * Rebuild the rules against the current handle. Null when resolving itself
 * fails mid-shutdown — the next tick retries either way.
 */
function rewireRules(
  deps: ReconcileDeps,
): { run: ReturnType<typeof createRunReconciler>; sweep: ReturnType<typeof createReconcileSweep> } | null {
  try {
    return wireReconcileRules({
      ...deps,
      db: deps.bb.storage.database(),
    });
  } catch {
    return null;
  }
}

/**
 * Logged, not silent: a quiet resolve here would hide the next occurrence
 * of the most frequent fatal this server ever had.
 */
function reportClosedHandle(deps: ReconcileDeps, error: unknown): void {
  try {
    deps.bb.log.warn(
      `reconcile: database handle was closed (${
        error instanceof Error ? error.message : String(error)
      }); rewiring to a live handle`,
    );
  } catch {
    /* logging must never fail the pass it reports on */
  }
}

export type ExecutionReconcile = ReturnType<typeof createExecutionReconcile>;
export type { ReconcileDeps, ReconcileResult } from "./execution-reconcile-deps.js";

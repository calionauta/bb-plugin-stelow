/**
 * The boundary rule. A native run that stops for a human is the one state the
 * reconciler cannot infer: it owns a card question carrying the boundary
 * marker, and until that question exists the run is not "handled" however the
 * host words its status.
 *
 * The rule is a module-level function over the dependency slice rather than a
 * closure member, so it can be called directly in a test with a recording
 * double — no factory, no in-flight guard, no composition root to stand up.
 */
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import {
  markExecutionNeedsInputSent,
  transitionExecutionRun,
  type ExecutionRun,
} from "../lib/execution-run-ledger.mjs";
import type { CardNotifier, ReconcileBoundary } from "./execution-reconcile-deps.js";
import type { WorkerCard } from "./workers-types.js";

type Db = ReturnType<BbPluginApi["storage"]["database"]>;

export type BoundaryDeps = {
  db: Db;
  randomId: (prefix: string) => string;
  fetchPendingQuestions: (
    threadId: string | null,
  ) => Promise<Array<{ question: string }>>;
  logComment: (cardId: string, targetId: string, body: string) => void;
  notify: CardNotifier;
};

export function createBoundaryReconciler(deps: BoundaryDeps) {
  return {
    reconcileBoundary: (run: ExecutionRun, card: WorkerCard, boundary: ReconcileBoundary) =>
      reconcileBoundary(deps, run, card, boundary),
  };
}

export async function reconcileBoundary(
  deps: BoundaryDeps,
  run: ExecutionRun,
  card: WorkerCard,
  boundary: ReconcileBoundary,
): Promise<void> {
  if (run.normalizedStatus !== "needs_input") {
    const boundaryId = deps.randomId("boundary");
    run = transitionExecutionRun(deps.db, run.id, "needs_input", {
      nativeStatus: run.nativeStatus,
      boundaryId,
      boundaryQuestion: boundary.question,
    });
    deps.logComment(
      card.id,
      run.id,
      `Native ${run.recipeId} run needs input. Boundary: ${boundary.question}`,
    );
    notifyBoundaryOpen(deps.notify, card, run.recipeId, boundaryId, boundary.question);
  } else if (!run.needsInputSentAt) {
    notifyBoundaryMissing(deps.notify, card, run.recipeId, run.boundaryId);
  }
  const pending = await deps.fetchPendingQuestions(card.worker_thread_id);
  const marker = run.boundaryId;
  if (marker && pending.some((entry) => entry.question.includes(`[Stelow boundary ${marker}]`))) {
    markExecutionNeedsInputSent(deps.db, run.id);
  }
}

function notifyBoundaryOpen(
  notify: CardNotifier,
  card: WorkerCard,
  recipeId: string,
  boundaryId: string,
  question: string,
): void {
  notify.sendToCard(
    card,
    [
      `The native ${recipeId} run is waiting for input.`,
      "Ask this exact question on the card with the structured question tool,",
      `include the marker [Stelow boundary ${boundaryId}] in the question text, then stop.`,
      `Do not invent an answer or resume the run yourself: ${question}`,
    ].join(" "),
  );
}

function notifyBoundaryMissing(
  notify: CardNotifier,
  card: WorkerCard,
  recipeId: string,
  boundaryId: string | null,
): void {
  notify.sendToCard(
    card,
    [
      `Create the pending card question for native ${recipeId}`,
      `and include the marker [Stelow boundary ${boundaryId}].`,
      "Do not resume until it is answered.",
    ].join(" "),
  );
}

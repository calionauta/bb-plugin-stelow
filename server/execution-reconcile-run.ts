/**
 * The one-run rule. This is where the host's word about a run becomes the
 * database's word: the native status is normalized, dispatched to the boundary
 * or artifact rule, and the card is republished only if the row actually moved.
 * Runs that are already terminal, unstarted, or cardless are answered without a
 * host round trip, because asking again cannot change any of them.
 */
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import {
  getExecutionRun,
  transitionExecutionRun,
  type ExecutionRun,
} from "../lib/execution-run-ledger.mjs";
import { nativeNeedsInput } from "./bb-workflow-bridge.js";
import type { ReconcileBoundary, ReconcileResult } from "./execution-reconcile-deps.js";
import type { ExecutionNative } from "./execution-native.js";
import type { WorkerCard } from "./workers-types.js";

type Db = ReturnType<BbPluginApi["storage"]["database"]>;

/** The two rules this one dispatches to, as narrow as they can be written. */
export type RunDispatch = {
  reconcileBoundary: (
    run: ExecutionRun,
    card: WorkerCard,
    boundary: ReconcileBoundary,
  ) => Promise<void>;
  reconcileArtifacts: (card: WorkerCard, run: ExecutionRun) => Promise<void>;
};

export type RunDeps = {
  db: Db;
  now: () => number;
  getCard: (cardId: string) => WorkerCard | undefined;
  logComment: (cardId: string, targetId: string, body: string) => void;
  publishCard: (cardId: string) => void;
  native: ExecutionNative;
  dispatch: RunDispatch;
};

const SIMPLE_STATES = ["queued", "running", "failed", "cancelled"] as const;
type SimpleState = typeof SIMPLE_STATES[number];

export function createRunReconciler(deps: RunDeps) {
  return { reconcileOne: (runId: string) => reconcileOne(deps, runId) };
}

export async function reconcileOne(deps: RunDeps, runId: string): Promise<ReconcileResult> {
  let run = getExecutionRun(deps.db, runId);
  if (!run) return { run: null, error: "Execution run not found." };
  if (["succeeded", "failed", "cancelled"].includes(run.normalizedStatus)) {
    return { run, error: null };
  }
  if (!run.runId) {
    if (deps.now() - run.createdAt > 60_000) {
      run = transitionExecutionRun(deps.db, run.id, "failed", { errorCode: "native-start-timeout" });
    }
    return { run, error: null };
  }
  const card = deps.getCard(run.cardId);
  if (!card?.worker_thread_id) return { run, error: null };
  const before = runKey(run);
  try {
    const native = await deps.native.adapterFor(run).status({ runId: run.runId });
    await applyNativeState(deps, card, run, native);
    const current = getExecutionRun(deps.db, run.id);
    if (current && runKey(current) !== before) deps.publishCard(current.cardId);
    return { run: current, error: null };
  } catch (error) {
    return {
      run,
      error: error instanceof Error ? error.message : "Unable to reconcile native execution.",
    };
  }
}

/**
 * One native status, one destination. A boundary wins over everything else: a
 * run that reports success while still holding an open question is a run asking
 * a question, not a run that finished.
 */
async function applyNativeState(
  deps: RunDeps,
  card: WorkerCard,
  run: ExecutionRun,
  native: { state: string },
): Promise<void> {
  const boundary = nativeNeedsInput(native);
  if (native.state === "needs_input" || boundary) {
    await deps.dispatch.reconcileBoundary(run, card, boundary ?? fallbackBoundary(run));
    return;
  }
  if (native.state === "succeeded" && run.normalizedStatus !== "needs_input") {
    const fresh = getExecutionRun(deps.db, run.id) ?? run;
    await deps.dispatch.reconcileArtifacts(card, fresh);
    return;
  }
  if (SIMPLE_STATES.includes(native.state as SimpleState)) {
    reconcileSimpleState(deps, card, run, native.state as SimpleState);
  }
}

function reconcileSimpleState(
  deps: RunDeps,
  card: WorkerCard,
  run: ExecutionRun,
  state: SimpleState,
): void {
  if (state === run.normalizedStatus) return;
  transitionExecutionRun(deps.db, run.id, state, {
    nativeStatus: state,
    errorCode: state === "failed" ? "unknown-native-state" : null,
  });
  if (state === "failed") {
    deps.logComment(
      card.id,
      run.id,
      `Native ${run.recipeId} failed with native status ${run.nativeStatus}. `
      + "The card remains available for retry.",
    );
  }
}

/** What the row looks like before and after: the tell for "this really moved". */
function runKey(run: ExecutionRun | null): string {
  if (!run) return "missing";
  return [
    run.normalizedStatus,
    run.runId ?? "",
    run.completionEventId ?? "",
    run.needsInputSentAt ?? "",
    run.boundaryId ?? "",
  ].join(":");
}

function fallbackBoundary(run: ExecutionRun): ReconcileBoundary {
  return {
    question: `The ${run.recipeId} workflow needs a human decision before it can continue.`,
    questionId: null,
  };
}

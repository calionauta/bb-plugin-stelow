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
  markReconcileFailed,
  markReconcileReached,
  transitionExecutionRun,
  type ExecutionRun,
} from "../lib/execution-run-ledger.mjs";
import { nativeNeedsInput } from "./bb-workflow-bridge.js";
import type { ReconcileBoundary, ReconcileResult } from "./execution-reconcile-deps.js";
import type { ExecutionNative } from "./execution-native.js";
import type { WorkerCard } from "./workers-types.js";

type Db = ReturnType<BbPluginApi["storage"]["database"]>;

/**
 * What the host tells us about a run: the normalized state, plus the reason when
 * it reported a failure.
 *
 * `scriptError` is not invented here — `scriptOutcome` in bb-workflow-bridge
 * reads the recipe script's own `{ state, error, outputs }` and folds the real
 * message in. This type used to be `{ state: string }`, which is what let a
 * known failure be recorded as `unknown-native-state`: the reason was on the
 * wire and the signature refused to carry it.
 */
type NativeStatus = {
  state: string;
  scriptError?: string | null;
};

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

/**
 * How long the host may stop answering about a run before the run is failed.
 *
 * Generous on purpose: this is a recovery path for a host that has actually
 * gone away, not a latency budget, and a workflow that legitimately runs for
 * hours must not be failed by one slow poll. Ten minutes of continuous silence
 * is not a blip — and a run that is only unreachable for a moment never reaches
 * it, because one answered poll closes the window.
 */
export const NATIVE_UNREACHABLE_MS = 10 * 60_000;

/** The reason a reader sees, in the run's own vocabulary. */
export const NATIVE_UNREACHABLE = "the host stopped answering about this run";

/**
 * Why a run failed, as far as we actually know.
 *
 * The host's script outcome already carries the reason — `scriptOutcome` in
 * bb-workflow-bridge reads `{ state, error, outputs }` and folds a real message
 * into `scriptError`, including the silent no-op case ("the recipe produced no
 * task outputs"). That reason used to die one layer down: the reconciler typed
 * the native status as `{ state }`, threw the message away, and wrote the
 * literal `unknown-native-state` — a name that says the STATE is unknown, at
 * the exact point where the state was matched from a known set. The card then
 * logged "Native scope-map failed with native status queued", quoting the
 * pre-transition value while claiming the post-transition one.
 *
 * So this is one fact with one representation. The reason is read from the
 * host, stored once, and quoted from the value that was just written — never
 * reconstructed from something adjacent. When the host genuinely gives no
 * reason, the code says THAT, which is a different and true statement.
 */
function failureReason(native: NativeStatus, state: SimpleState): string {
  if (state !== "failed") return "";
  const reason = typeof native.scriptError === "string" ? native.scriptError.trim() : "";
  if (reason) return reason;
  // A host that reported a failure without saying why is a real gap, and it is
  // a gap about the REASON. Saying "no reason was recorded" is honest and
  // actionable; saying "unknown state" is neither, and sends a reader looking
  // for a state problem that does not exist.
  return "the host reported a failure without a reason";
}

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
    markReconcileReached(deps.db, run.id);
    if (current && runKey(current) !== before) deps.publishCard(current.cardId);
    return { run: current, error: null };
  } catch (error) {
    return unreachable(deps, run, error);
  }
}

/**
 * The host could not be asked about this run.
 *
 * A run whose status nobody can read is not a run making progress, and leaving
 * it live forever is how a card is pinned as "running" by a workflow that died
 * hours ago: the liveness rule trusts the ledger, the ledger is written in
 * exactly one place, and a function that returns an error and changes nothing is
 * a signal that never decays. So the unanswerable is bounded — generously, so a
 * blip is not a verdict — and when the bound passes the run fails, which is a
 * state the card can show, the stage gate can hold on, and Retry can act on.
 *
 * The clock starts at the FIRST failure rather than at the run's start, so a
 * plugin restart cannot condemn a healthy long-running workflow: the first
 * unanswerable poll opens the window, and an answered poll closes it.
 */
function unreachable(deps: RunDeps, run: ExecutionRun, error: unknown): ReconcileResult {
  markReconcileFailed(deps.db, run.id, deps.now());
  const failed = failedIfUnreachable(deps, run.id);
  if (failed) {
    deps.logComment(
      failed.cardId,
      failed.id,
      `Native ${failed.recipeId} stopped answering after ${Math.round(NATIVE_UNREACHABLE_MS / 1000)}s `
      + "and the run was marked failed. Retry run to try it again.",
    );
    deps.publishCard(failed.cardId);
  }
  return {
    run: failed ?? getExecutionRun(deps.db, run.id) ?? run,
    error: error instanceof Error ? error.message : "Unable to reconcile native execution.",
  };
}

/**
 * Fail a run the host has stopped answering about, once the window has passed.
 *
 * Null means "still inside the window" — which is the common case and the one
 * that must not be noisy. The window is measured from the first failed poll,
 * which `markReconcileFailed` stamps and `markReconcileReached` clears.
 */
function failedIfUnreachable(deps: RunDeps, runId: string) {
  const current = getExecutionRun(deps.db, runId);
  if (!current?.reconcileFailedAt) return null;
  if (deps.now() - current.reconcileFailedAt < NATIVE_UNREACHABLE_MS) return null;
  return transitionExecutionRun(deps.db, runId, "failed", { errorCode: NATIVE_UNREACHABLE });
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
  native: NativeStatus,
): Promise<void> {
  const boundary = nativeNeedsInput(native);
  if (native.state === "needs_input" || boundary) {
    await deps.dispatch.reconcileBoundary(run, card, boundary ?? fallbackBoundary(run));
    return;
  }
  if (native.state === "succeeded" && run.normalizedStatus !== "needs_input") {
    // A finished run is recorded finished. This branch used to reconcile
    // artifacts and return, leaving the row on whatever the launch wrote — and
    // the launch wrote a terminal state, so the run stayed `succeeded` with a
    // `native_status` still reading `running`. The two columns disagreed, and
    // the card showed a run finished while it executed. The host's word is the
    // only thing that may write a terminal state, so it is written here.
    let settled = getExecutionRun(deps.db, run.id) ?? run;
    if (settled.normalizedStatus !== "succeeded") {
      // `queued → succeeded` is not a legal transition, and forcing it throws
      // into the catch below — which is how the first version of this fix
      // silently stopped settling rows. A run the host reports finished did
      // start, so it walks the legal path and the ledger's own rules apply.
      if (settled.normalizedStatus === "queued") {
        settled = transitionExecutionRun(deps.db, run.id, "running", { nativeStatus: "running" });
      }
      settled = transitionExecutionRun(deps.db, run.id, "succeeded", { nativeStatus: "succeeded" });
    }
    await deps.dispatch.reconcileArtifacts(card, settled);
    return;
  }
  if (SIMPLE_STATES.includes(native.state as SimpleState)) {
    reconcileSimpleState(deps, card, run, native, native.state as SimpleState);
  }
}

function reconcileSimpleState(
  deps: RunDeps,
  card: WorkerCard,
  run: ExecutionRun,
  native: NativeStatus,
  state: SimpleState,
): void {
  if (state === run.normalizedStatus) return;
  const reason = failureReason(native, state);
  const next = transitionExecutionRun(deps.db, run.id, state, {
    nativeStatus: state,
    errorCode: reason || null,
  });
  if (state !== "failed") return;
  // Quote what was just WRITTEN, never the value this replaced. The old line
  // interpolated `run.nativeStatus` — the status BEFORE the transition — into a
  // sentence that said "failed", so the card's own log read "Native scope-map
  // failed with native status queued". One fact, one representation, read back
  // from the row that now holds it.
  deps.logComment(
    card.id,
    run.id,
    `Native ${run.recipeId} failed: ${next.errorCode ?? reason}. `
    + "The card remains available for retry.",
  );
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

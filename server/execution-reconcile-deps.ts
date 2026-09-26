/**
 * What the reconciler's rules share. The reconciler itself is only the
 * composition root and the in-flight guard; the boundary, artifact, run and
 * sweep rules each take the slice of this they need, so a rule module never
 * reaches for a dependency it does not use and the root stays free to wire them
 * in a different order.
 */
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { ExecutionRun } from "../lib/execution-run-ledger.mjs";
import type { ExecutionNative } from "./execution-native.js";
import type { WorkerCard } from "./workers-types.js";

type Db = ReturnType<BbPluginApi["storage"]["database"]>;

export type ReconcilePendingQuestion = { question: string };
export type ReconcileResult = { run: ExecutionRun | null; error: string | null };
/**
 * The host's boundary payload, not just its question: the contract the human
 * answers is validated before the run parks, so an unanswerable boundary fails
 * the run instead of opening a question nobody can settle.
 */
export type ReconcileBoundary = Record<string, unknown> & { question: string; questionId: string | null };

/** The only lifecycle call the reconciler makes: stop what it no longer owns. */
export type ReconcileStopper = {
  stopOwned: (cardId: string, reason: string) => Promise<boolean>;
};

export type ReconcileDeps = {
  db: Db;
  bb: BbPluginApi;
  now: () => number;
  randomId: (prefix: string) => string;
  getCard: (cardId: string) => WorkerCard | undefined;
  cardWorkspace: (card: WorkerCard) => Promise<{ path: string } | null>;
  fetchPendingQuestions: (threadId: string | null) => Promise<ReconcilePendingQuestion[]>;
  logComment: (cardId: string, targetId: string, body: string) => void;
  publishCard: (cardId: string) => void;
  native: ExecutionNative;
  lifecycle: ReconcileStopper;
};

/**
 * A note to the worker thread. Every rule that changes a run's state says so on
 * the card and tells the worker, so the notifier is shared rather than
 * re-implemented per rule: two copies of "post to the thread, never throw" are
 * two copies to keep in step.
 */
export type CardNotifier = {
  sendToCard: (card: WorkerCard, text: string) => void;
};

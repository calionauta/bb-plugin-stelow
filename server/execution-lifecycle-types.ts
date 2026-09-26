/**
 * The shapes the lifecycle rules share: what a resume is handed, what it may
 * hand back, and the slice of the host the three rules — stop, resume, start —
 * each read. Publish is a dependency rather than a call because every rule that
 * moves a run's state has to say so on the card, and three copies of that
 * publish are three copies to keep in step.
 */
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { ExecutionRun } from "../lib/execution-run-ledger.mjs";
import type { BoundaryVersions } from "./execution-boundary.js";
import type { ExecutionNative } from "./execution-native.js";
import type { WorkerCard } from "./workers-types.js";

type Db = ReturnType<BbPluginApi["storage"]["database"]>;

export type AnswerDecision = { question: string; answers: string[] };
export type ResumeArgs = { context: Record<string, unknown>; localRunId: string; recipeId: string };
export type ResumeFailure = { error: string | null };
export type StartContext = {
  prompt: string;
  intent?: string;
  stage?: string;
  reviewMode?: string;
};

export type LifecycleDeps = {
  db: Db;
  bb: BbPluginApi;
  randomId: (prefix: string) => string;
  getCard: (cardId: string) => WorkerCard | undefined;
  logComment: (cardId: string, targetId: string, body: string) => void;
  native: ExecutionNative;
  /**
   * The shape versions the card's state is at RIGHT NOW. A boundary answer is
   * checked against these before the run resumes: answering a scope map that has
   * since moved on is not an answer, it is a stale decision.
   */
  boundaryVersions: (run: ExecutionRun) => Promise<BoundaryVersions | null>;
};

/** What every rule adds to the host slice: the card-state publish. */
export type LifecycleRuleDeps = LifecycleDeps & {
  publishCard: (cardId: string) => void;
};

import { listExecutionRuns, projectExecutionRun } from "../lib/execution-run-ledger.mjs";
import { createLifecycleResumer } from "./execution-lifecycle-resume.js";
import { createLifecycleStarter } from "./execution-lifecycle-start.js";
import { createLifecycleStopper } from "./execution-lifecycle-stop.js";
import type { LifecycleDeps } from "./execution-lifecycle-types.js";

/**
 * The lifecycle is a composition root over three rules: stop a run, resume a run
 * from a boundary answer, start a run. Each rule takes the slice of the host it
 * reads, so the refusals in one are legible without the other two, and each can
 * be driven in a test with a double. This file wires them and owns the one thing
 * none of them should: what a card's run list looks like from outside.
 *
 * It used to export `keepsCardRunning` as well — the rule that a card with a
 * live run must stay running. Nothing called it: the sync loop read the idle
 * thread, found no question, and parked cards that were mid-workflow, offering
 * a Resume for work already in flight. The rule now lives in
 * `lib/native-run.mjs` beside the sentence it derives, and the sync owns it.
 * One owner, one reader: a second export here was a second thing to forget to
 * call, which is exactly how the first one died.
 */
export function createExecutionLifecycle(deps: LifecycleDeps) {
  const publishCard = (cardId: string) => deps.bb.realtime.publish("card-state", { cardId });
  const shared = { ...deps, publishCard };
  const stop = createLifecycleStopper(shared);
  const resume = createLifecycleResumer({ ...shared, listRuns: (cardId) => listExecutionRuns(deps.db, cardId) });
  const start = createLifecycleStarter(shared);

  return {
    list: (cardId: string) => listExecutionRuns(deps.db, cardId),
    detailList: (cardId: string) => listExecutionRuns(deps.db, cardId).map(projectExecutionRun),
    resumeAfterAnswers: resume.resumeAfterAnswers,
    routeAnswerContinuation: resume.routeAnswerContinuation,
    stopOwned: stop.stopOwned,
    handlers: {
      startExecutionRun: start.startExecutionRun,
      executionRuns: async ({ cardId }: { cardId: string }) => ({
        runs: listExecutionRuns(deps.db, cardId),
      }),
      cancelExecutionRun: stop.cancelExecutionRun,
    },
  };
}

export type ExecutionLifecycle = ReturnType<typeof createExecutionLifecycle>;
export type {
  AnswerDecision,
  LifecycleDeps,
  StartContext,
} from "./execution-lifecycle-types.js";

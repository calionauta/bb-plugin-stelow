/**
 * The resume rule. Answering a boundary never resumes the run in place: a
 * resumed run gets a child row, a child artifact root, and the parent's own row
 * is cancelled as `resumed-by-child`, so the ledger reads as a history rather
 * than a run whose arguments changed under it. The two failure paths matter as
 * much as the happy one: a resume that cannot start must leave the boundary
 * exactly as open as it found it, or the card waits forever on a question
 * nobody can re-ask.
 */
import {
  createExecutionRun,
  getExecutionRun,
  markExecutionResumeRequested,
  resetExecutionBoundary,
  resumeArtifactRoot,
  transitionExecutionRun,
  type ExecutionRun,
} from "../lib/execution-run-ledger.mjs";
import { formatBatchContinuation } from "../lib/question-batch.mjs";
import { recipeById } from "../lib/recipe-catalog.mjs";
import { boundaryAnswerError } from "./execution-boundary.js";
import type {
  AnswerDecision,
  LifecycleRuleDeps,
  ResumeArgs,
} from "./execution-lifecycle-types.js";

export type ResumeDeps = Pick<
  LifecycleRuleDeps,
  "db" | "bb" | "randomId" | "getCard" | "logComment" | "native" | "publishCard" | "boundaryVersions"
> & {
  /** The card's live runs, narrowed: only the boundary rule reads them. */
  listRuns: (cardId: string) => ExecutionRun[];
};

type PreparedResume = { childId: string; childRoot: string; args: ResumeArgs };

export function createLifecycleResumer(deps: ResumeDeps) {
  return {
    resumeAfterAnswers: (run: ExecutionRun, decisions: AnswerDecision[]) =>
      resumeAfterAnswers(deps, run, decisions),
    routeAnswerContinuation: (cardId: string, threadId: string, decisions: AnswerDecision[]) =>
      routeAnswerContinuation(deps, cardId, threadId, decisions),
  };
}

export async function resumeAfterAnswers(
  deps: ResumeDeps,
  run: ExecutionRun,
  decisions: AnswerDecision[],
): Promise<string | null> {
  // The contract is checked against the card's CURRENT shape before anything is
  // prepared: an answer to a boundary that has since moved on resumes nothing,
  // and the run stays open on the question that is actually current.
  const answerError = await boundaryAnswerRefusal(deps, run, decisions);
  if (answerError) return answerError;
  let prepared: PreparedResume | { error: string };
  try {
    prepared = await prepareResume(deps, run, decisions);
  } catch (error) {
    return failResume(deps, run, `missing-${Date.now()}`, error);
  }
  if ("error" in prepared) return prepared.error;
  try {
    claimChildRun(deps, run, prepared);
    return await resumeChild(deps, run, prepared);
  } catch (error) {
    return failResume(deps, run, prepared.childId, error);
  }
}

async function boundaryAnswerRefusal(
  deps: ResumeDeps,
  run: ExecutionRun,
  decisions: AnswerDecision[],
): Promise<string | null> {
  const boundaryDecision = decisions.find((decision) =>
    decision.question.includes(`[Stelow boundary ${run.boundaryId}]`),
  );
  const currentVersions = await deps.boundaryVersions(run);
  return boundaryAnswerError(
    run.boundaryContract,
    currentVersions,
    boundaryDecision?.answers.join(", ") ?? "",
  );
}

/**
 * Answers that are not a boundary answer are just an answer: they go to the
 * worker thread as a batch continuation and the run is left alone. Only a
 * question carrying the run's own boundary marker resumes anything, which is
 * what stops an unrelated "yes" on the card from restarting a workflow.
 */
export async function routeAnswerContinuation(
  deps: ResumeDeps,
  cardId: string,
  threadId: string,
  decisions: AnswerDecision[],
): Promise<ExecutionRun | null> {
  const run = boundaryRun(deps, cardId);
  const boundaryAnswer = Boolean(
    run?.boundaryId
    && decisions.some((decision) => decision.question.includes(`[Stelow boundary ${run.boundaryId}]`)),
  );
  if (!boundaryAnswer) {
    await deps.bb.sdk.threads.send({
      threadId,
      mode: "auto",
      input: [{ type: "text", text: formatBatchContinuation(decisions), mentions: [] }],
    });
  }
  return boundaryAnswer ? run ?? null : null;
}

function boundaryRun(deps: ResumeDeps, cardId: string): ExecutionRun | undefined {
  return deps.listRuns(cardId)
    .find((entry) => entry.normalizedStatus === "needs_input" && Boolean(entry.runId));
}

async function prepareResume(
  deps: ResumeDeps,
  run: ExecutionRun,
  decisions: AnswerDecision[],
): Promise<PreparedResume | { error: string }> {
  if (!run.runId) return { error: "The native boundary has no run identity to resume." };
  const parsed = parseResumeArgs(run.argsText);
  if (!parsed) return { error: "The native run arguments are incomplete." };
  const childId = `${run.id}-resume-${deps.randomId("run")}`;
  const childRoot = resumeArtifactRoot(run.artifactRoot);
  const args: ResumeArgs = {
    recipeId: parsed.recipeId,
    localRunId: childId,
    context: { ...parsed.context, artifactRoot: childRoot, resumeAnswers: decisions },
  };
  try {
    await deps.bb.sdk.files.mkdir({ path: childRoot, rootPath: run.workspaceId, recursive: true });
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Unable to create the native resume workspace." };
  }
  return { childId, childRoot, args };
}

function claimChildRun(
  deps: ResumeDeps,
  run: ExecutionRun,
  prepared: PreparedResume,
): void {
  createExecutionRun(deps.db, {
    id: prepared.childId,
    cardId: run.cardId,
    projectId: run.projectId,
    recipeId: run.recipeId,
    stage: run.stage,
    sourceHash: run.sourceHash,
    sourceText: run.sourceText,
    argsText: JSON.stringify(prepared.args),
    adapter: run.adapter,
    workspaceId: run.workspaceId,
    artifactRoot: prepared.childRoot,
    originThreadId: run.originThreadId,
    resumeOf: run.id,
    nativeStatus: "resume-requested",
  });
  markExecutionResumeRequested(deps.db, run.id);
}

async function resumeChild(
  deps: ResumeDeps,
  run: ExecutionRun,
  prepared: PreparedResume,
): Promise<string | null> {
  const recipe = recipeById(run.recipeId);
  const resumed = await deps.native.adapterFor(run).resume(
    { runId: run.runId },
    { args: prepared.args, required_capabilities: recipe?.required_capabilities ?? [] },
  );
  transitionExecutionRun(deps.db, prepared.childId, launchState(resumed.state), {
    runId: String(record(resumed).runId ?? run.runId ?? ""),
    nativeStatus: resumed.state,
  });
  if (resumed.state === "succeeded") {
    transitionExecutionRun(deps.db, prepared.childId, "succeeded", { nativeStatus: resumed.state });
  }
  transitionExecutionRun(deps.db, run.id, "cancelled", { errorCode: "resumed-by-child" });
  deps.logComment(run.cardId, prepared.childId, `Native ${run.recipeId} resumed as child run ${prepared.childId}.`);
  deps.publishCard(run.cardId);
  return null;
}

async function failResume(
  deps: ResumeDeps,
  run: ExecutionRun,
  childId: string,
  error: unknown,
): Promise<string> {
  const message = error instanceof Error ? error.message : "Unable to resume the native workflow.";
  deps.logComment(run.cardId, childId, `Native ${run.recipeId} resume failed: ${message}`);
  failChildRun(deps, childId);
  resetExecutionBoundary(deps.db, run.id);
  await reaskBoundary(deps, run);
  return message;
}

/** A child that may already be terminal is not a second failure to report. */
function failChildRun(deps: ResumeDeps, childId: string): void {
  if (!getExecutionRun(deps.db, childId)) return;
  try {
    transitionExecutionRun(deps.db, childId, "failed", { errorCode: "resume-start-failed" });
  } catch {
    /* the child is already terminal; the boundary is what needs resetting */
  }
}

async function reaskBoundary(deps: ResumeDeps, run: ExecutionRun): Promise<void> {
  const card = deps.getCard(run.cardId);
  if (!card?.worker_thread_id || !run.boundaryId) return;
  const marker = run.boundaryId;
  void deps.bb.sdk.threads.send({
    threadId: card.worker_thread_id,
    mode: "auto",
    input: [{
      type: "text",
      text: [
        `The native resume failed. Re-create the card question with marker [Stelow boundary ${marker}]`,
        "and wait for the answer; do not mark it answered or resume without a new answer.",
      ].join(" "),
      mentions: [],
    }],
  }).catch(() => undefined);
}

function parseResumeArgs(argsText: string): ResumeArgs | null {
  const parsed = record(record(JSON.parse(argsText)));
  if (
    !parsed.context
    || typeof parsed.localRunId !== "string"
    || typeof parsed.recipeId !== "string"
  ) return null;
  return {
    context: parsed.context as Record<string, unknown>,
    localRunId: parsed.localRunId,
    recipeId: parsed.recipeId,
  };
}

/** A host that already finished the resume still leaves a run to reconcile. */
function launchState(state: string): string {
  return state === "succeeded" ? "running" : state;
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

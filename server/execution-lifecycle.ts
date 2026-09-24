import { join } from "node:path";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import {
  activeExecutionRun,
  createExecutionRun,
  getExecutionRun,
  listExecutionRuns,
  markExecutionResumeRequested,
  resetExecutionBoundary,
  transitionExecutionRun,
  type ExecutionRun,
} from "../lib/execution-run-ledger.mjs";
import { isArchivedCard } from "../lib/worker-action-policy.mjs";
import { formatBatchContinuation } from "../lib/question-batch.mjs";
import { recipeById } from "../lib/recipe-catalog.mjs";
import type { ExecutionNative } from "./execution-native.js";
import type { WorkerCard } from "./workers-types.js";

type Db = ReturnType<BbPluginApi["storage"]["database"]>;
type StartContext = {
  prompt: string;
  intent?: string;
  stage?: string;
  reviewMode?: string;
};
type AnswerDecision = { question: string; answers: string[] };
type ResumeFailure = { error: string | null };
type ResumeArgs = { context: Record<string, unknown>; localRunId: string; recipeId: string };

type LifecycleDeps = {
  db: Db;
  bb: BbPluginApi;
  randomId: (prefix: string) => string;
  getCard: (cardId: string) => WorkerCard | undefined;
  logComment: (cardId: string, targetId: string, body: string) => void;
  native: ExecutionNative;
};

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function createExecutionLifecycle(deps: LifecycleDeps) {
  function publishCard(cardId: string): void {
    deps.bb.realtime.publish("card-state", { cardId });
  }

  async function cancelRemoteRun(run: ExecutionRun): Promise<string | null> {
    if (run.adapter !== "bb-workflows" || !run.runId) return null;
    try {
      await deps.native.adapterFor(run).cancel({ runId: run.runId });
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : "Unable to stop native workflow.";
    }
  }

  async function cancelExecutionRun({ runId }: { runId: string }) {
    const run = getExecutionRun(deps.db, runId);
    if (!run) return { ok: false, run: null, error: "Execution run not found." };
    if (["succeeded", "failed", "cancelled"].includes(run.normalizedStatus)) {
      return { ok: true, run, error: null };
    }
    const error = await cancelRemoteRun(run);
    if (error) return { ok: false, run, error };
    const cancelled = transitionExecutionRun(deps.db, run.id, "cancelled", { errorCode: "user-cancelled" });
    deps.logComment(run.cardId, run.id, `Native ${run.recipeId} run cancelled by the user.`);
    publishCard(run.cardId);
    return { ok: true, run: cancelled, error: null };
  }

  async function stopOwned(cardId: string, reason: string): Promise<boolean> {
    const active = listExecutionRuns(deps.db, cardId)
      .filter((run) => ["queued", "running", "needs_input"].includes(run.normalizedStatus));
    let stopped = true;
    for (const run of active) {
      const error = await cancelRemoteRun(run);
      if (error) {
        stopped = false;
        continue;
      }
      transitionExecutionRun(deps.db, run.id, "cancelled", { errorCode: reason });
      deps.logComment(run.cardId, run.id, `Native ${run.recipeId} run cancelled: ${reason}.`);
    }
    return stopped;
  }

  function keepsCardRunning(cardId: string, openQuestionCount: number): boolean {
    const run = activeExecutionRun(deps.db, cardId);
    if (!run) return false;
    if (["queued", "running"].includes(run.normalizedStatus)) return true;
    return run.normalizedStatus === "needs_input" && openQuestionCount === 0;
  }

  async function routeAnswerContinuation(
    cardId: string,
    threadId: string,
    decisions: AnswerDecision[],
  ): Promise<ExecutionRun | null> {
    const run = listExecutionRuns(deps.db, cardId)
      .find((entry) => entry.normalizedStatus === "needs_input" && Boolean(entry.runId));
    const boundaryAnswer = Boolean(
      run?.boundaryId
      && decisions.some((decision) => decision.question.includes(`[Stelow boundary ${run.boundaryId}]`)),
    );
    if (!boundaryAnswer) {
      await deps.bb.sdk.threads.send({
        threadId,
        mode: "auto",
        input: [{
          type: "text",
          text: formatBatchContinuation(decisions),
          mentions: [],
        }],
      });
    }
    return boundaryAnswer ? run ?? null : null;
  }

  async function startExecutionRun({
    cardId,
    recipeId,
    context,
  }: {
    cardId: string;
    recipeId: string;
    context: StartContext;
  }) {
    const card = deps.getCard(cardId);
    if (!card) return { ok: false, run: null, error: "Card not found." };
    if (isArchivedCard(card)) return { ok: false, run: null, error: "This card is archived." };
    const result = await deps.native.startNativeStageForCard(card, recipeId, context);
    if (result.run) {
      deps.logComment(cardId, result.run.id, `Native ${recipeId} run started${result.run.runId ? ` (${result.run.runId})` : ""}.`);
      publishCard(cardId);
    }
    return result;
  }

  async function prepareResume(
    run: ExecutionRun,
    decisions: AnswerDecision[],
  ): Promise<{ childId: string; childRoot: string; args: ResumeArgs } | ResumeFailure> {
    if (!run.runId) return { error: "The native boundary has no run identity to resume." };
    const parsed = record(JSON.parse(run.argsText)) as Partial<ResumeArgs>;
    if (!parsed.context || typeof parsed.localRunId !== "string" || typeof parsed.recipeId !== "string") {
      return { error: "The native run arguments are incomplete." };
    }
    const childId = `${run.id}-resume-${deps.randomId("run")}`;
    const childRoot = join(run.artifactRoot, "resume", childId);
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

  async function failResume(
    run: ExecutionRun,
    childId: string,
    error: unknown,
  ): Promise<string> {
    const message = error instanceof Error ? error.message : "Unable to resume the native workflow.";
    deps.logComment(run.cardId, childId, `Native ${run.recipeId} resume failed: ${message}`);
    const child = getExecutionRun(deps.db, childId);
    if (child) {
      try { transitionExecutionRun(deps.db, childId, "failed", { errorCode: "resume-start-failed" }); }
      catch { /* child may already be terminal */ }
    }
    resetExecutionBoundary(deps.db, run.id);
    const card = deps.getCard(run.cardId);
    if (card?.worker_thread_id && run.boundaryId) {
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
    return message;
  }

  async function resumeAfterAnswers(
    run: ExecutionRun,
    decisions: AnswerDecision[],
  ): Promise<string | null> {
    let prepared: { childId: string; childRoot: string; args: ResumeArgs } | ResumeFailure;
    try {
      prepared = await prepareResume(run, decisions);
    } catch (error) {
      return failResume(run, `missing-${Date.now()}`, error);
    }
    if ("error" in prepared) return prepared.error;
    const { childId, childRoot, args } = prepared;
    try {
      createExecutionRun(deps.db, {
        id: childId,
        cardId: run.cardId,
        projectId: run.projectId,
        recipeId: run.recipeId,
        stage: run.stage,
        sourceHash: run.sourceHash,
        sourceText: run.sourceText,
        argsText: JSON.stringify(args),
        adapter: run.adapter,
        workspaceId: run.workspaceId,
        artifactRoot: childRoot,
        originThreadId: run.originThreadId,
        resumeOf: run.id,
        nativeStatus: "resume-requested",
      });
      markExecutionResumeRequested(deps.db, run.id);
      const recipe = recipeById(run.recipeId);
      const resumed = await deps.native.adapterFor(run).resume(
        { runId: run.runId },
        { args, required_capabilities: recipe?.required_capabilities ?? [] },
      );
      const resumeState = resumed.state === "succeeded" ? "running" : resumed.state;
      transitionExecutionRun(deps.db, childId, resumeState, {
        runId: String(record(resumed).runId ?? run.runId ?? ""),
        nativeStatus: resumed.state,
      });
      if (resumed.state === "succeeded") {
        transitionExecutionRun(deps.db, childId, "succeeded", {
          nativeStatus: resumed.state,
        });
      }
      transitionExecutionRun(deps.db, run.id, "cancelled", { errorCode: "resumed-by-child" });
      deps.logComment(run.cardId, childId, `Native ${run.recipeId} resumed as child run ${childId}.`);
      publishCard(run.cardId);
      return null;
    } catch (error) {
      return failResume(run, childId, error);
    }
  }

  return {
    list: (cardId: string) => listExecutionRuns(deps.db, cardId),
    keepsCardRunning,
    resumeAfterAnswers,
    routeAnswerContinuation,
    stopOwned,
    handlers: {
      startExecutionRun,
      executionRuns: async ({ cardId }: { cardId: string }) => ({
        runs: listExecutionRuns(deps.db, cardId),
      }),
      cancelExecutionRun,
    },
  };
}

export type ExecutionLifecycle = ReturnType<typeof createExecutionLifecycle>;

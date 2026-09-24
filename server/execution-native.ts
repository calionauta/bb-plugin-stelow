import { createHash } from "node:crypto";
import { join } from "node:path";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { ExecutionAdapter } from "../lib/execution-adapter.mjs";
import { activeExecutionRun, createExecutionRun, transitionExecutionRun, type ExecutionRun } from "../lib/execution-run-ledger.mjs";
import { BB_NATIVE_CAPABILITIES, missingNativeCapabilities } from "../lib/bb-workflow-capabilities.mjs";
import { recipeById, type Recipe } from "../lib/recipe-catalog.mjs";
import { resolveExecutionRoute, type ExecutionRoute } from "../lib/execution-route.mjs";
import { skippedStages } from "../lib/stage-skips.mjs";
import { parseWorkflowConfig } from "../lib/workflow-config.mjs";
import { STAGE_BY_ID, STAGE_SEQUENCE } from "../lib/workflow-vocabulary.mjs";
import { createBbWorkflowAdapter } from "./bb-workflow-adapter.js";
import {
  nativeWorkflowAvailable,
  nativeWorkflowStatus,
  renderInlineWorkflowScript,
  runNativeWorkflow,
  stopNativeWorkflow,
} from "./bb-workflow-bridge.js";
import type { WorkerCard } from "./workers-types.js";

type Db = ReturnType<BbPluginApi["storage"]["database"]>;
type Workspace = { path: string; hostId: string | null };
type CardRoute = {
  recipeId: string;
  recipe: Recipe | null;
  route: ExecutionRoute;
};
type StartContext = {
  prompt: string;
  intent?: string;
  stage?: string;
  reviewMode?: string;
};
type StartResult = {
  ok: boolean;
  run: ExecutionRun | null;
  error: string | null;
};
type NativeTransport = { workspaceId: string; projectId: string; threadId: string };
type WorkflowContext = ReturnType<typeof parseWorkflowConfig> & { productType: string | null };
type PreparedStart = {
  recipe: Recipe;
  stage: (typeof STAGE_BY_ID)[string];
  stateDir: string | null;
  workspacePath: string;
  artifactRoot: string;
  source: string;
  sourceHash: string;
  args: Record<string, unknown>;
};

type NativeDeps = {
  db: Db;
  bb: BbPluginApi;
  randomId: (prefix: string) => string;
  cardWorkspace: (card: WorkerCard) => Promise<Workspace | null>;
  stateDir: (card: WorkerCard, rootPath: string) => Promise<string | null>;
  logComment: (cardId: string, targetId: string, body: string) => void;
};

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function requiredCapabilities(stage: (typeof STAGE_BY_ID)[string], recipe: Recipe): string[] {
  return [...new Set([
    ...stringArray(stage.execution?.required_capabilities),
    ...stringArray(recipe.required_capabilities),
    ...(recipe.tasks ?? []).flatMap((task) => stringArray(task.requirements)),
  ])];
}

function canonicalStage(stageId: string | undefined, recipeId: string) {
  if (stageId) return STAGE_BY_ID[stageId];
  return Object.values(STAGE_BY_ID).find((entry) => entry.execution?.recipe === recipeId);
}

function workflowContext(content: string): WorkflowContext {
  const productType = content.match(/^\s*product_type:\s*(.+)$/m)?.[1]
    ?.trim()
    .replace(/^["']|["']$/g, "") ?? null;
  return { ...parseWorkflowConfig(content), productType };
}

function createAdapter(
  transport: NativeTransport,
  sourceText: string,
  argsText: string,
): ExecutionAdapter {
  let fallbackArgs: Record<string, unknown> = {};
  try {
    fallbackArgs = record(JSON.parse(argsText));
  } catch {
    fallbackArgs = {};
  }
  const adapter = createBbWorkflowAdapter({
    run: async ({ recipe: _recipe, context }) => {
      const values = record(context);
      const source = typeof values.workflowSource === "string" ? values.workflowSource : sourceText;
      const args = record(values.workflowArgs);
      return runNativeWorkflow({
        ...transport,
        source,
        args: Object.keys(args).length > 0 ? args : fallbackArgs,
      });
    },
    status: async (handle) => nativeWorkflowStatus({
      ...transport,
      runId: String(record(handle).runId ?? ""),
    }),
    resume: async (handle, input) => {
      const args = record(record(input).args);
      return runNativeWorkflow({
        ...transport,
        source: sourceText,
        args: Object.keys(args).length > 0 ? args : fallbackArgs,
        resumeRunId: String(record(handle).runId ?? ""),
      });
    },
    cancel: async (handle) => {
      await stopNativeWorkflow({ ...transport, runId: String(record(handle).runId ?? "") });
      return { state: "cancelled" };
    },
    result: async (handle) => nativeWorkflowStatus({
      ...transport,
      runId: String(record(handle).runId ?? ""),
    }),
  });
  if (!adapter) throw new Error("BB Workflows adapter is unavailable.");
  return adapter;
}

export function createExecutionNative(deps: NativeDeps) {
  function adapterFor(run: Pick<ExecutionRun, "workspaceId" | "projectId" | "originThreadId" | "sourceText" | "argsText">) {
    return createAdapter(
      {
        workspaceId: run.workspaceId,
        projectId: run.projectId,
        threadId: run.originThreadId,
      },
      run.sourceText,
      run.argsText,
    );
  }

  async function resolveStageExecutionRoute(
    card: WorkerCard,
    stageId: string,
    workspacePath: string,
  ): Promise<CardRoute | null> {
    const recipeId = STAGE_BY_ID[stageId]?.execution?.recipe;
    if (!recipeId) return null;
    const recipe = recipeById(recipeId);
    if (!recipe) {
      return {
        recipeId,
        recipe: null,
        route: {
          mode: "refused",
          code: "fallback-unknown",
          reason: `Unknown recipe ${recipeId}.`,
          redirect: "Fix the canonical recipe catalog.",
        },
      };
    }
    const stage = STAGE_BY_ID[stageId];
    const nativeCandidate = recipe.write_policy !== "workspace"
      && recipe.id !== "scope-batch"
      && Boolean(card.worker_thread_id);
    const nativeAvailable = nativeCandidate
      ? await nativeWorkflowAvailable({
          projectId: card.project_id,
          threadId: card.worker_thread_id!,
          workspaceId: workspacePath,
        })
      : false;
    return {
      recipeId,
      recipe,
      route: resolveExecutionRoute({
        recipe,
        requiredCapabilities: requiredCapabilities(stage, recipe),
        nativeCapabilities: BB_NATIVE_CAPABILITIES,
        nativeAvailable,
      }),
    };
  }

  function recordCoordinatorSequentialRoute(
    cardId: string,
    stage: string,
    recipeId: string,
    route: { reason?: string; missingCapabilities?: string[]; preserves?: string[] },
  ): void {
    const marker = `[stelow-execution-route:${cardId}:${stage}:${recipeId}]`;
    const exists = deps.db.prepare("SELECT 1 FROM comments WHERE card_id = ? AND body LIKE ? LIMIT 1")
      .get(cardId, `%${marker}%`);
    if (exists) return;
    const missing = route.missingCapabilities?.length
      ? ` Missing native capabilities: ${route.missingCapabilities.join(", ")}.`
      : "";
    const preserves = route.preserves?.length
      ? ` Preserved: ${route.preserves.join(", ")}.`
      : "";
    deps.logComment(
      cardId,
      cardId,
      [
        `Coordinator-sequential execution selected for ${stage} (${recipeId}).`,
        `${route.reason ?? "Native execution was not selected."}${missing}${preserves}`,
        marker,
      ].join(" "),
    );
  }

  async function prepareStart(
    card: WorkerCard,
    recipe: Recipe,
    stage: (typeof STAGE_BY_ID)[string],
    context: StartContext,
  ): Promise<{ prepared?: PreparedStart; error?: string }> {
    const workspace = await deps.cardWorkspace(card);
    if (!workspace?.path) return { error: "The card workspace is unavailable." };
    if (!await nativeWorkflowAvailable({
      projectId: card.project_id,
      threadId: card.worker_thread_id!,
      workspaceId: workspace.path,
    })) return { error: "BB Workflows is unavailable for this card thread; use the coordinator fallback." };
    const stateDir = card.dir_hash
      ? await deps.stateDir(card, workspace.path).catch(() => null)
      : null;
    if (card.dir_hash && !stateDir) {
      return { error: "Workflow state ownership cannot be verified for native execution." };
    }
    const localId = deps.randomId("exec");
    const artifactRoot = join(stateDir ?? join(workspace.path, ".stelow"), "runs", localId);
    try {
      await deps.bb.sdk.files.mkdir({ path: artifactRoot, rootPath: workspace.path, recursive: true });
    } catch (error) {
      return { error: error instanceof Error ? error.message : "Unable to create the run staging directory." };
    }
    let source: string;
    try {
      source = renderInlineWorkflowScript(recipe, { ...context, localRunId: localId });
    } catch (error) {
      return { error: error instanceof Error ? error.message : "Unable to render workflow source." };
    }
    const config = stateDir
      ? await deps.bb.sdk.files.read({ path: join(stateDir, "state.md") })
        .then((file) => workflowContext(file.content))
        .catch(() => workflowContext(""))
      : workflowContext("");
    const skipped = skippedStages({
      kind: card.kind,
      intent: card.intent,
      reviewMode: config.reviewMode,
      reviewGates: config.reviewGates,
      sequence: STAGE_SEQUENCE,
    }).skipped.some((entry) => entry.stage === stage.id);
    if (skipped) return { error: `Stage ${stage.id} is skipped by the active review route.` };
    return {
      prepared: {
        recipe,
        stage,
        stateDir,
        workspacePath: workspace.path,
        artifactRoot,
        source,
        sourceHash: createHash("sha256").update(source).digest("hex"),
        args: {
          context: {
            ...context,
            ...config,
            uiScopePresent: config.productType === "software",
            intent: card.intent,
            stage: stage.id,
            artifactRoot,
          },
          localRunId: localId,
          recipeId: recipe.id,
        },
      },
    };
  }

  async function startNativeStageForCard(
    card: WorkerCard,
    recipeId: string,
    context: StartContext,
    expectedStage?: string,
  ): Promise<StartResult> {
    if (!card.worker_thread_id) return { ok: false, run: null, error: "This card has no coordinator thread." };
    const existing = activeExecutionRun(deps.db, card.id);
    if (existing) return { ok: false, run: existing, error: "This card already owns an active execution run." };
    const recipe = recipeById(recipeId);
    if (!recipe) return { ok: false, run: null, error: `Unknown recipe ${recipeId}.` };
    const stage = canonicalStage(expectedStage, recipeId);
    if (!stage || stage.execution?.recipe !== recipeId) {
      return { ok: false, run: null, error: `Recipe ${recipeId} is not the current stage's canonical recipe.` };
    }
    if (recipeId === "scope-batch" || recipe.write_policy === "workspace" || stage.execution?.write_policy === "workspace") {
      return { ok: false, run: null, error: "Workspace-writing execution is coordinator-sequential until host file claims and parent merge are proven." };
    }
    const missing = missingNativeCapabilities(requiredCapabilities(stage, recipe));
    if (missing.length > 0) {
      return { ok: false, run: null, error: `BB Workflows cannot provide required capabilities: ${missing.join(", ")}.` };
    }
    const preparation = await prepareStart(card, recipe, stage, context);
    if (!preparation.prepared) return { ok: false, run: null, error: preparation.error ?? "Unable to prepare native execution." };
    const prepared = preparation.prepared;
    const localId = String(prepared.args.localRunId);
    let run: ExecutionRun;
    try {
      run = createExecutionRun(deps.db, {
        id: localId,
        cardId: card.id,
        projectId: card.project_id,
        recipeId,
        stage: stage.id,
        sourceHash: prepared.sourceHash,
        sourceText: prepared.source,
        argsText: JSON.stringify(prepared.args),
        adapter: "bb-workflows",
        workspaceId: prepared.workspacePath,
        artifactRoot: prepared.artifactRoot,
        originThreadId: card.worker_thread_id,
        nativeStatus: "requested",
      });
    } catch (error) {
      return { ok: false, run: null, error: error instanceof Error ? error.message : "Unable to claim the card execution slot." };
    }
    return launchNativeRun(card, prepared, run);
  }

  async function launchNativeRun(card: WorkerCard, prepared: PreparedStart, run: ExecutionRun): Promise<StartResult> {
    try {
      const native = await adapterFor(run).run(prepared.recipe, {
        prompt: card.prompt,
        workflowSource: prepared.source,
        workflowArgs: prepared.args,
      });
      const launchState = native.state === "succeeded" ? "running" : native.state;
      let started = transitionExecutionRun(deps.db, run.id, launchState, {
        runId: String(record(native).runId ?? ""),
        nativeStatus: native.state,
        previewDirective: typeof record(native).previewDirective === "string"
          ? record(native).previewDirective
          : null,
      });
      if (native.state === "succeeded") {
        started = transitionExecutionRun(deps.db, run.id, "succeeded", {
          nativeStatus: native.state,
        });
      }
      void deps.bb.sdk.threads.send({
        threadId: card.worker_thread_id!,
        mode: "auto",
        input: [{
          type: "text",
          text: [
            `Native Stelow execution ${record(native).runId} now owns the ${prepared.stage.id} stage workspace.`,
            "Pause stage work and wait for its result; do not edit state.md or gates while it runs.",
          ].join(" "),
          mentions: [],
          visibility: "agent-only",
        }],
      }).catch(() => undefined);
      return { ok: true, run: started, error: null };
    } catch (error) {
      const failed = transitionExecutionRun(deps.db, run.id, "failed", { errorCode: "native-start-failed" });
      return { ok: false, run: failed, error: error instanceof Error ? error.message : "Unable to start the native workflow." };
    }
  }

  return {
    adapterFor,
    resolveStageExecutionRoute,
    recordCoordinatorSequentialRoute,
    startNativeStageForCard,
  };
}

export type ExecutionNative = ReturnType<typeof createExecutionNative>;
export type ExecutionRouteInfo = CardRoute;

/**
 * The preparation rule: everything a run needs before it may start, and every
 * reason it may not. It is split in two because it is the one place a native
 * start can fail for six unrelated reasons — a missing workspace, an
 * unavailable host, unowned state, a staging directory that will not mkdir, an
 * unrenderable script, a stage the active review route skips — and a single
 * reader cannot hold all six. Staging is what it establishes; arguments are
 * what it then assembles.
 */
import { createHash } from "node:crypto";
import { join } from "node:path";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { skippedStages } from "../lib/stage-skips.mjs";
import { STAGE_SEQUENCE } from "../lib/workflow-vocabulary.mjs";
import { nativeWorkflowAvailable, renderInlineWorkflowScript } from "./bb-workflow-bridge.js";
import { decisionReadsBlock } from "./runtime/decision-reads.js";
import { loadDecisionReceipts } from "./runtime/decision-store.js";
import { workflowContext } from "./execution-native-catalog.js";
import type {
  PreparedStart,
  StartContext,
  WorkflowContext,
  WorkflowStage,
} from "./execution-native-types.js";
import type { Recipe } from "../lib/recipe-catalog.mjs";
import type { WorkerCard } from "./workers-types.js";

export type PrepareDeps = {
  bb: BbPluginApi;
  randomId: (prefix: string) => string;
  cardWorkspace: (card: WorkerCard) => Promise<{ path: string } | null>;
  stateDir: (card: WorkerCard, rootPath: string) => Promise<string | null>;
};

export type PreparedOrError =
  | { prepared: PreparedStart; error?: undefined }
  | { prepared?: undefined; error: string };

export function createNativeStartPreparer(deps: PrepareDeps) {
  return {
    prepareStart: (
      card: WorkerCard,
      recipe: Recipe,
      stage: WorkflowStage,
      context: StartContext,
    ) => prepareStart(deps, card, recipe, stage, context),
  };
}

export async function prepareStart(
  deps: PrepareDeps,
  card: WorkerCard,
  recipe: Recipe,
  stage: WorkflowStage,
  context: StartContext,
): Promise<PreparedOrError> {
  const staged = await stageRun(deps, card, recipe, context);
  if ("error" in staged) return staged;
  const config = await readWorkflowConfig(deps, staged.stateDir);
  const skipped = skippedStages({
    kind: card.kind,
    intent: card.intent,
    reviewMode: config.reviewMode,
    reviewGates: config.reviewGates,
    sequence: STAGE_SEQUENCE,
  }).skipped.some((entry) => entry.stage === stage.id);
  if (skipped) return { error: `Stage ${stage.id} is skipped by the active review route.` };
  // Past decisions covering these scopes ride into the run. Fail-soft: a card
  // without receipts (or an unreadable store) prepares exactly as before.
  const stored = await loadStoredReceipts(deps, staged.stateDir);
  const receipts = context.decisionReceipts ?? stored;
  return { prepared: runArguments(staged, card, recipe, stage, context, config, receipts) };
}

async function loadStoredReceipts(
  deps: PrepareDeps,
  stateDir: string | null,
): Promise<Array<{ id: string; kind?: string; scopeIds?: string[] }>> {
  if (!stateDir) return [];
  try {
    const stored = await loadDecisionReceipts(deps.bb.sdk.files, stateDir);
    return stored.map((entry) => ({
      id: entry.id,
      kind: typeof entry.kind === "string" ? entry.kind : "selection",
      scopeIds: Array.isArray(entry.scopeIds) ? entry.scopeIds.filter((id) => typeof id === "string") : [],
    }));
  } catch {
    return [];
  }
}

/** The workspace, the host's willingness, the state dir, the staging root, the script. */
async function stageRun(
  deps: PrepareDeps,
  card: WorkerCard,
  recipe: Recipe,
  context: StartContext,
): Promise<Staged | { error: string }> {
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
  try {
    const source = renderInlineWorkflowScript(recipe, { ...context, localRunId: localId });
    return { stateDir, workspacePath: workspace.path, artifactRoot, localId, source };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Unable to render workflow source." };
  }
}

type Staged = {
  stateDir: string | null;
  workspacePath: string;
  artifactRoot: string;
  localId: string;
  source: string;
};

/**
 * The workflow's own configuration, read from the state directory this run is
 * allowed to own. A card with no owned state gets the defaults rather than a
 * failure: an absent `state.md` is a fresh card, not a broken one.
 */
async function readWorkflowConfig(
  deps: PrepareDeps,
  stateDir: string | null,
): Promise<WorkflowContext> {
  if (!stateDir) return workflowContext("");
  return deps.bb.sdk.files.read({ path: join(stateDir, "state.md") })
    .then((file) => workflowContext(file.content))
    .catch(() => workflowContext(""));
}

function runArguments(
  staged: Staged,
  card: WorkerCard,
  recipe: Recipe,
  stage: WorkflowStage,
  context: StartContext,
  config: WorkflowContext,
  receipts: Array<{ id: string; kind?: string; scopeIds?: string[] }>,
): PreparedStart {
  // Past decisions covering these scopes ride along as mandatory reads. Empty
  // by default: cards without receipts prepare exactly as before.
  const decisionReads = decisionReadsBlock(receipts, context.scopeIds ?? []);
  return {
    recipe,
    stage,
    stateDir: staged.stateDir,
    workspacePath: staged.workspacePath,
    artifactRoot: staged.artifactRoot,
    source: staged.source,
    sourceHash: createHash("sha256").update(staged.source).digest("hex"),
    args: {
      context: {
        ...context,
        ...config,
        decisionReads,
        uiScopePresent: config.productType === "software",
        intent: card.intent,
        stage: stage.id,
        artifactRoot: staged.artifactRoot,
      },
      localRunId: staged.localId,
      recipeId: recipe.id,
    },
  };
}

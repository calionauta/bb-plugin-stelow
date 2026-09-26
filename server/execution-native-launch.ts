/**
 * The launch rule: claim the card's single execution slot, then hand the run to
 * the host. The refusals are the rule — one active run per card, a known recipe,
 * the recipe that actually belongs to this stage, no workspace-writing work, no
 * capability the host cannot provide — because each one is a decision a user
 * reads as "why did nothing happen", and a start that skips a check is a card
 * that silently stalls.
 */
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import {
  activeExecutionRun,
  createExecutionRun,
  transitionExecutionRun,
  type ExecutionRun,
} from "../lib/execution-run-ledger.mjs";
import { missingNativeCapabilities } from "../lib/bb-workflow-capabilities.mjs";
import { recipeById, type Recipe } from "../lib/recipe-catalog.mjs";
import { canonicalStage, record, requiredCapabilities } from "./execution-native-catalog.js";
import type { PreparedOrError } from "./execution-native-prepare.js";
import type {
  PreparedStart,
  StartContext,
  StartResult,
  WorkflowStage,
} from "./execution-native-types.js";
import type { WorkerCard } from "./workers-types.js";

type Db = ReturnType<BbPluginApi["storage"]["database"]>;

export type LaunchDeps = {
  db: Db;
  bb: BbPluginApi;
  adapterFor: (run: PreparedRun) => { run: (recipe: unknown, context: unknown) => Promise<NativeOutcome> };
  prepareStart: (card: WorkerCard, recipe: Recipe, stage: WorkflowStage, context: StartContext) => Promise<PreparedOrError>;
};

type PreparedRun = Pick<
  ExecutionRun,
  "workspaceId" | "projectId" | "originThreadId" | "sourceText" | "argsText" | "id"
>;

type NativeOutcome = { state: string; runId?: unknown; previewDirective?: unknown };

export function createNativeLauncher(deps: LaunchDeps) {
  return {
    startNativeStageForCard: (
      card: WorkerCard,
      recipeId: string,
      context: StartContext,
      expectedStage?: string,
    ) => startNativeStageForCard(deps, card, recipeId, context, expectedStage),
  };
}

export async function startNativeStageForCard(
  deps: LaunchDeps,
  card: WorkerCard,
  recipeId: string,
  context: StartContext,
  expectedStage: string | undefined,
): Promise<StartResult> {
  if (!card.worker_thread_id) {
    return { ok: false, run: null, error: "This card has no coordinator thread." };
  }
  const existing = activeExecutionRun(deps.db, card.id);
  if (existing) {
    return { ok: false, run: existing, error: "This card already owns an active execution run." };
  }
  const recipe = recipeById(recipeId);
  if (!recipe) return { ok: false, run: null, error: `Unknown recipe ${recipeId}.` };
  const stage = canonicalStage(expectedStage, recipeId);
  if (!stage || stage.execution?.recipe !== recipeId) {
    return { ok: false, run: null, error: `Recipe ${recipeId} is not the current stage's canonical recipe.` };
  }
  if (recipeId === "scope-batch" || recipe.write_policy === "workspace" || stage.execution?.write_policy === "workspace") {
    return { ok: false, run: null, error: WORKSPACE_WRITE_REFUSAL };
  }
  const missing = missingNativeCapabilities(requiredCapabilities(stage, recipe));
  if (missing.length > 0) {
    return { ok: false, run: null, error: `BB Workflows cannot provide required capabilities: ${missing.join(", ")}.` };
  }
  return claimAndLaunch(deps, card, recipeId, await deps.prepareStart(card, recipe, stage, context));
}

const WORKSPACE_WRITE_REFUSAL = "Workspace-writing execution is coordinator-sequential until host file claims and parent merge are proven.";

async function claimAndLaunch(
  deps: LaunchDeps,
  card: WorkerCard,
  recipeId: string,
  preparation: { prepared?: PreparedStart; error?: string },
): Promise<StartResult> {
  if (!preparation.prepared) {
    return { ok: false, run: null, error: preparation.error ?? "Unable to prepare native execution." };
  }
  const prepared = preparation.prepared;
  let run: ExecutionRun;
  try {
    run = createExecutionRun(deps.db, {
      id: String(prepared.args.localRunId),
      cardId: card.id,
      projectId: card.project_id,
      recipeId,
      stage: prepared.stage.id,
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
  return launchNativeRun(deps, card, prepared, run);
}

/**
 * A host that reports the run already finished has still got work to do: the
 * card's own coordinator is told to stop editing the state the run now owns.
 */
async function launchNativeRun(
  deps: LaunchDeps,
  card: WorkerCard,
  prepared: PreparedStart,
  run: ExecutionRun,
): Promise<StartResult> {
  try {
    const native = await deps.adapterFor(run).run(prepared.recipe, {
      prompt: card.prompt,
      workflowSource: prepared.source,
      workflowArgs: prepared.args,
    });
    const launched = recordRunIdentity(deps, run.id, native);
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
    return { ok: true, run: launched, error: null };
  } catch (error) {
    const failed = transitionExecutionRun(deps.db, run.id, "failed", { errorCode: "native-start-failed" });
    return {
      ok: false,
      run: failed,
      error: error instanceof Error ? error.message : "Unable to start the native workflow.",
    };
  }
}

function recordRunIdentity(
  deps: LaunchDeps,
  runId: string,
  native: NativeOutcome,
): ExecutionRun {
  const launchState = native.state === "succeeded" ? "running" : native.state;
  const started = transitionExecutionRun(deps.db, runId, launchState, {
    runId: String(record(native).runId ?? ""),
    nativeStatus: native.state,
    previewDirective: typeof record(native).previewDirective === "string"
      ? record(native).previewDirective
      : null,
  });
  if (native.state !== "succeeded") return started;
  return transitionExecutionRun(deps.db, runId, "succeeded", { nativeStatus: native.state });
}

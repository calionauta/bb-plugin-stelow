/**
 * The launch rule: claim the card's single execution slot, then hand the run to
 * the host. The refusals are the rule — one active run per card, a known recipe,
 * the recipe that actually belongs to this stage, no workspace-writing work, no
 * capability the host cannot provide — because each one is a decision a user
 * reads as "why did nothing happen", and a start that skips a check is a card
 * that silently stalls.
 */
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { ActionRecorder } from "./runtime/action-log-runtime.js";
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
  /** Receipt for the coordinator pause-note when the send itself fails. */
  noteSendFailure?: (cardId: string, targetId: string, body: string) => void;
  actions?: ActionRecorder;
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
    // The launch is the only moment every run passes through. Recording the
    // start from the reconciler missed runs whose first observed state was
    // already `succeeded` (14 of 20 finishes had no start row on the live log).
    deps.actions?.record({
      kind: "run.started",
      outcome: "ok",
      cardId: card.id,
      runId: run.id,
      stage: run.stage,
      detail: { recipe: run.recipeId },
    });
    noteRunOwnership(deps, card, prepared, native, run);
    return { ok: true, run: launched, error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to start the native workflow.";
    const failed = transitionExecutionRun(deps.db, run.id, "failed", { errorCode: "native-start-failed" });
    deps.actions?.record({
      kind: "run.finished",
      outcome: "error",
      cause: "run.start-failed",
      cardId: card.id,
      runId: failed.id,
      stage: run.stage,
      detail: { recipe: run.recipeId, error: message.slice(0, 300) },
    });
    return { ok: false, run: failed, error: message };
  }
}

/**
 * Tell the card's coordinator that the run now owns its stage workspace.
 *
 * The pause-note is advisory, but its failure is not silent: when the
 * coordinator cannot be told to stand down it keeps editing a workspace the run
 * now owns, so the card records the miss as a receipt.
 */
function noteRunOwnership(
  deps: LaunchDeps,
  card: WorkerCard,
  prepared: PreparedStart,
  native: NativeOutcome,
  run: ExecutionRun,
): void {
  const originThreadId = card.worker_thread_id!;
  void deps.bb.sdk.threads.send({
    threadId: originThreadId,
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
  }).catch((error: unknown) => {
    try {
      deps.noteSendFailure?.(
        card.id,
        run.id,
        `The coordinator could not be told to pause for native run ${record(native).runId ?? run.id} (${
          error instanceof Error ? error.message : "send failed"
        }). It may keep editing the stage workspace the run now owns; tell it to pause explicitly.`,
      );
    } catch {
      /* the receipt is owed, never load-bearing */
    }
  });
}

/**
 * Record what the host answered at launch, and nothing more.
 *
 * `native.state === "succeeded"` here means the host ACCEPTED the dispatch, so
 * the run is `running` — the work has not happened yet. This function used to
 * say exactly that on the first line and then overwrite it with `"succeeded"`
 * on the last, giving one value two meanings ten lines apart, and marking the
 * run finished the moment it was launched.
 *
 * That was not cosmetic. Terminal states accept no further transitions, and the
 * reconciler answers a terminal run without a host round trip, so a run marked
 * finished at launch could never be corrected: the adapter was never asked what
 * was actually happening, and `native_status` kept whatever it held mid-flight.
 * Every run in the live database was in that state — 31 at succeeded/running, 8
 * at failed/running, 5 at failed/queued — and not one with a terminal native
 * status. The card reported a run done before it ran, and two such runs looked
 * identical because they carried the same frozen state.
 *
 * So the host alone decides when a run finishes. Launch says `running`; the
 * reconciler writes the terminal state when the host reports one.
 */
function recordRunIdentity(
  deps: LaunchDeps,
  runId: string,
  native: NativeOutcome,
): ExecutionRun {
  const launchState = native.state === "succeeded" ? "running" : native.state;
  return transitionExecutionRun(deps.db, runId, launchState, {
    runId: String(record(native).runId ?? ""),
    nativeStatus: native.state,
    previewDirective: typeof record(native).previewDirective === "string"
      ? record(native).previewDirective
      : null,
  });
}

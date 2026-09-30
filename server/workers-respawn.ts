import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { replaceCardWorker } from "./workers-spawn.js";
import { beginRespawn, endRespawn } from "./workers-respawn-guard.js";
import { workerEnvironment } from "./workers.js";
import type { Preset, RespawnOptions, RespawnPreparation, WorkerDeps } from "./workers.js";
import type { WorkerCard } from "./workers-types.js";

type SpawnArgs = Parameters<BbPluginApi["sdk"]["threads"]["spawn"]>[0];
type ThreadEnvironment = SpawnArgs["environment"];

/**
 * What replacing a worker reads.
 *
 * `WorkerDeps` plus the three closures that live in `workers.ts` and would
 * otherwise have to be exported to be called from here: the lineage and card
 * ledger writers, and the environment resolver. Narrowing the slice is what
 * lets the whole replacement be driven in a test with a double.
 */
export type RespawnDeps = WorkerDeps & {
  recordThread: (cardId: string, threadId: string, presetId: string | null, reason: string) => unknown;
  lineage: (input: {
    rootPath: string;
    dirHash: string;
    threadId: string;
    presetId: string | null;
    reason: string;
  }) => Promise<void>;
  continuingEnvironment: (card: WorkerCard, fallback: ThreadEnvironment) => Promise<ThreadEnvironment>;
};

export type RespawnOutcome = { ok: boolean; error?: string; threadId?: string };

type Prepared = Extract<RespawnPreparation, { prompt: string }>;

/**
 * Replace the card's worker thread, one at a time.
 *
 * The guard — and the reasoning behind refusing a second caller rather than
 * queueing it — lives in `workers-respawn-guard.ts`; this is the mechanics.
 * The file exists because spawning a replacement is a different operation from
 * running one, and folding it back into `workers.ts` pushed that file past its
 * budget, which is the shape gate doing its job rather than a style preference.
 */
export async function respawn(
  deps: RespawnDeps,
  cardId: string,
  presetId: string,
  reason = "band-swap",
  options?: RespawnOptions,
): Promise<RespawnOutcome> {
  const refusal = beginRespawn(cardId, reason);
  if (refusal) return { ok: false, error: refusal };
  try {
    return await replaceWorkerThread(deps, cardId, presetId, reason, options);
  } finally {
    endRespawn(cardId);
  }
}

async function replaceWorkerThread(
  deps: RespawnDeps,
  cardId: string,
  presetId: string,
  reason: string,
  options?: RespawnOptions,
): Promise<RespawnOutcome> {
  const card = deps.getCard(cardId);
  if (!card) return { ok: false, error: deps.errors.cardNotFound };
  const preset = deps.getPreset(presetId);
  if (!preset) return { ok: false, error: deps.errors.presetNotFound };
  const prepared = await deps.prepareRespawn(card, preset, reason, options);
  if ("error" in prepared) return { ok: false, error: prepared.error };
  try {
    return await replaceWorker(deps, card, preset, reason, options, prepared);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Respawn failed.";
    deps.updateCard(cardId, { activity: "error", last_error: message });
    return { ok: false, error: message };
  }
}

/**
 * Spawn the replacement, then stop the thread it replaces.
 *
 * That order is deliberate, and it is why the guard above exists: a card must
 * never be left with no worker because a spawn failed halfway. The cost is a
 * brief window with two live threads, which is only safe if a second respawn
 * cannot start inside it.
 */
async function replaceWorker(
  deps: RespawnDeps,
  card: WorkerCard,
  preset: Preset,
  reason: string,
  options: RespawnOptions | undefined,
  prepared: Prepared,
): Promise<RespawnOutcome> {
  const params = deps.presetParams(preset);
  const thread = await replaceCardWorker(deps.bb, {
    projectId: card.project_id,
    environment: await deps.continuingEnvironment(
      card,
      fallbackEnvironment(card, prepared, params),
    ),
    visibility: "hidden",
    title: `Stelow: ${card.display_name ?? card.name}`,
    providerId: params.providerId,
    model: params.modelId,
    reasoningLevel: params.reasoningLevel as SpawnArgs["reasoningLevel"],
    permissionMode: params.permissionMode as SpawnArgs["permissionMode"],
    executionInputSources: { providerId: "explicit", model: "explicit", reasoningLevel: "explicit", permissionMode: "explicit" },
    ...(prepared.input ? { input: prepared.input } : { prompt: prepared.prompt }),
  }, card.worker_thread_id);
  deps.updateCard(card.id, {
    worker_thread_id: thread.id,
    worker_preset_id: preset.id,
    preset_restart_pending: 0,
    activity: "running",
    last_error: null,
    updated_at: deps.now(),
  });
  deps.recordThread(card.id, thread.id, preset.id, reason);
  if (card.dir_hash) {
    void deps.lineage({
      rootPath: prepared.projectPath,
      dirHash: card.dir_hash,
      threadId: thread.id,
      presetId: preset.id,
      reason,
    });
  }
  await linkPreviousWorker(deps, card, thread.id, options?.previousProjectId);
  return { ok: true, threadId: thread.id };
}

function fallbackEnvironment(
  card: WorkerCard,
  prepared: Prepared,
  params: { environmentKind: string; machineId: string | null },
): ThreadEnvironment {
  if (!prepared.workspace) return { type: "project-default" as const };
  const source = { path: prepared.workspace.path, hostId: prepared.workspace.hostId ?? "" };
  return workerEnvironment(source, params, card.workspace_kind === "exploratory");
}

/**
 * Hand the new thread a pointer to the one it replaces.
 *
 * The replacement starts with an empty history by design — fresh delegation is
 * the rule, not an accident — so the continuity a card depends on has to be
 * spelled out here. A mention the new thread can follow, not a fork.
 */
async function linkPreviousWorker(
  deps: RespawnDeps,
  card: WorkerCard,
  threadId: string,
  previousProjectId?: string | null,
): Promise<void> {
  if (!card.worker_thread_id) return;
  try {
    const tag = "@previous-worker";
    const body = `Continuity link — ${tag} is the archived worker this thread replaces. Consult it if state.md is thin.`;
    const start = body.indexOf(tag);
    const resource = {
      kind: "thread" as const,
      label: `Stelow: ${card.display_name ?? card.name} (previous)`,
      threadId: card.worker_thread_id,
      projectId: previousProjectId ?? card.project_id,
    };
    await deps.bb.sdk.threads.send({
      threadId,
      mode: "auto",
      input: [{
        type: "text",
        text: body,
        mentions: [{ start, end: start + tag.length, resource }],
      }],
    });
  } catch { /* the prompt already names the previous thread */ }
}

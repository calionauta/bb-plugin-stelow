import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { spawnCardWorker, stopThread } from "./workers-spawn.js";
import { beginRespawn, claimRespawnRow, endRespawn, releaseRespawnRow } from "./workers-respawn-guard.js";
import {
  continuingEnvironment,
  workerEnvironment,
  type PresetParams,
  type ThreadEnvironment,
} from "./workers-environment.js";
import type { Preset, RespawnOptions, RespawnPreparation, WorkerCard } from "./workers-types.js";

type SpawnArgs = Parameters<BbPluginApi["sdk"]["threads"]["spawn"]>[0];
type Db = ReturnType<BbPluginApi["storage"]["database"]>;

/**
 * What replacing a worker reads.
 *
 * Declared here rather than imported, because the module that owns the wiring
 * (`workers.ts`) is the one that calls this: importing its dependency type back
 * would be a cycle, and the architecture gate refuses those. Declaring the
 * slice is also what lets the whole replacement be driven in a test with a
 * double — which a re-exported `WorkerDeps` would not.
 */
export type RespawnDeps = {
  db: Db;
  bb: BbPluginApi;
  now: () => number;
  getCard: (cardId: string) => WorkerCard | undefined;
  updateCard: (cardId: string, fields: Record<string, unknown>) => void;
  getPreset: (presetId: string) => Preset | null;
  presetParams: (preset: Preset) => PresetParams;
  prepareRespawn: (
    card: WorkerCard,
    preset: Preset,
    reason: string,
    options?: RespawnOptions,
  ) => Promise<RespawnPreparation>;
  recordThread: (cardId: string, threadId: string, presetId: string | null, reason: string) => unknown;
  lineage: (input: {
    rootPath: string;
    dirHash: string;
    threadId: string;
    presetId: string | null;
    reason: string;
  }) => Promise<void>;
  continuingEnvironment: (card: WorkerCard, fallback: ThreadEnvironment) => Promise<ThreadEnvironment>;
  /** Receipt for the continuity-link send when delivery itself fails. */
  noteLinkFailure?: (cardId: string, body: string) => void;
  errors: { cardNotFound: string; presetNotFound: string };
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
  // Durable half of the pre-claim: the memory guard dies with the process,
  // so the pending row is claimed here, before any host call, and released
  // in the finally below. A second holder — same process or another — is
  // refused without spawning, which is what keeps a double respawn from
  // orphaning the first replacement.
  let durable = true;
  try {
    durable = claimRespawnRow(deps.db, cardId, reason, deps.now());
  } catch {
    durable = true;
  }
  if (!durable) {
    endRespawn(cardId);
    return { ok: false, error: `This card is already replacing its worker thread (${reason}). Try again once it settles.` };
  }
  try {
    return await replaceWorkerThread(deps, cardId, presetId, reason, options);
  } finally {
    releaseRespawnRow(deps.db, cardId);
    endRespawn(cardId);
  }
}

/**
 * Atomic worker-slot claim: move the card's worker pointer from the thread
 * the respawn replaced to the thread it just spawned, in one conditional
 * write. Returns false when the pointer already moved — a concurrent
 * replacement won — so the caller can stop its own orphan instead of
 * stealing the card. `IS` (not `=`) compares the previous pointer because
 * the initial spawn claims from NULL, and NULL never equals anything.
 */
export function claimWorkerSlot(
  db: RespawnDeps["db"],
  cardId: string,
  expectedPrevious: string | null,
  next: string,
): boolean {
  try {
    const result = db.prepare(
      "UPDATE cards SET worker_thread_id = ? WHERE id = ? AND worker_thread_id IS ?",
    ).run(next, cardId, expectedPrevious) as { changes?: unknown };
    return Number(result?.changes ?? 0) >= 1;
  } catch {
    // A handle without the column (an old test double, never production —
    // migrations own the column) cannot arbitrate: proceed as before rather
    // than failing a spawn on bookkeeping.
    return true;
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
 * Spawn the replacement, claim the card's single worker slot for it, then
 * stop the thread it replaces.
 *
 * Spawn-before-stop is deliberate, and it is why the guard above exists: a
 * card must never be left with no worker because a spawn failed halfway. The
 * cost is a brief window with two live threads, which is only safe if a
 * second respawn cannot start inside it — and only correct if the swap itself
 * is atomic. The claim below is a conditional write: when a concurrent
 * replacement already moved the slot, this one stops its own orphan and
 * reports the loss instead of stealing the card out from under the winner.
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
  const previousThreadId = card.worker_thread_id;
  const spawnArgs = await workerSpawnArgs(deps, card, prepared, params);
  const thread = await spawnCardWorker(deps.bb, spawnArgs);
  if (!claimWorkerSlot(deps.db, card.id, previousThreadId, thread.id)) {
    // Lost the race: the winner owns the card, so this thread is an orphan
    // nobody will ever reach through the card. Stop it before returning, or
    // the reader sees one card and two live threads.
    await stopThread(deps.bb, thread.id);
    return { ok: false, error: "Another replacement claimed the worker slot first; the duplicate thread was stopped." };
  }
  await stopThread(deps.bb, previousThreadId);
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

/**
 * The spawn arguments for a replacement thread.
 *
 * Extracted from the replacement itself so that function reads as the swap —
 * spawn, claim, stop — and the environment and knob assembly sits in one place.
 * The caller awaits this because the environment lookup is asynchronous.
 */
async function workerSpawnArgs(
  deps: RespawnDeps,
  card: WorkerCard,
  prepared: Prepared,
  params: PresetParams,
): Promise<SpawnArgs> {
  return {
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
  };
}

function fallbackEnvironment(
  card: WorkerCard,
  prepared: Prepared,
  params: { environmentKind: string; machineId: string | null; baseBranch?: string | null },
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
  } catch (error) {
    // The prompt already names the previous thread, but a silent catch here
    // hid every delivery failure. The miss becomes a receipt on the card, so
    // a reader knows the new worker started without its continuity pointer.
    try {
      deps.noteLinkFailure?.(
        card.id,
        `The continuity link to the previous worker could not be delivered (${
          error instanceof Error ? error.message : "send failed"
        }). The replacement thread still started; consult the archived thread explicitly if state.md is thin.`,
      );
    } catch {
      /* the receipt is owed, never load-bearing */
    }
  }
}

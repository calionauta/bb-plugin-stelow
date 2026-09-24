import { join } from "node:path";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { failureCauseFromEvents } from "../lib/worker-failure.mjs";
import { recordWorkerThread } from "../lib/worker-ledger.mjs";
import { resetSpawnRetry } from "../lib/spawn-retry.mjs";
import { mergeLineageFile, writeMergedFile } from "../lib/workflow-lineage.mjs";
import { bandForCardKindStage } from "../lib/preset-staleness.mjs";
import { createWorkerHistory } from "./workers-history.js";
import { createWorkerRetry } from "./workers-retry.js";
import { createRespawnScheduler, defaultWorkerScheduler } from "./workers-scheduler.js";
import { replaceCardWorker, spawnCardWorker, stopThread } from "./workers-spawn.js";
import type { WorkerCard, WorkerScheduler, WorkerSpawnArgs } from "./workers-types.js";

export { runWorkerMigrations } from "./workers-migrations.js";
export type { WorkerCard } from "./workers-types.js";

type Db = ReturnType<BbPluginApi["storage"]["database"]>;
type SpawnArgs = Parameters<BbPluginApi["sdk"]["threads"]["spawn"]>[0];
type ThreadEnvironment = SpawnArgs["environment"];

type Preset = {
  id: string;
  name: string;
  provider_id: string;
  model_id: string;
  reasoning_level: string;
  permission_mode: string;
  environment_kind: string;
  base_branch: string | null;
  machine_id: string | null;
  instructions: string;
};

export type PresetParams = {
  providerId: string;
  modelId: string;
  reasoningLevel: string;
  permissionMode: string;
  environmentKind: string;
  baseBranch: string | null;
  machineId: string | null;
  instructions: string;
};

export type RespawnOptions = {
  strategyId?: string;
  flavor?: "restart" | "append";
  roundNo?: number;
  roundStamp?: string;
  roundFile?: string;
  previousProjectId?: string | null;
};

export type RespawnPreparation =
  | { error: string }
  | {
    prompt: string;
    input?: SpawnArgs["input"];
    projectPath: string;
    workspace: { path: string; hostId: string | null } | null;
  };

export type { WorkerHistoryEntry } from "./workers-history.js";

type WorkerEnvironment = {
  id?: string;
  path?: string | null;
  hostId?: string | null;
  status?: string;
};

type WorkerDeps = {
  db: Db;
  bb: BbPluginApi;
  now: () => number;
  getCard: (cardId: string) => WorkerCard | undefined;
  updateCard: (cardId: string, fields: Record<string, unknown>) => void;
  comment: (cardId: string, body: string) => void;
  getPreset: (presetId: string) => Preset | null;
  getReliablePreset: (band: string, cardId: string) => Preset;
  presetParams: (preset: Preset) => PresetParams;
  prepareRespawn: (
    card: WorkerCard,
    preset: Preset,
    reason: string,
    options?: RespawnOptions,
  ) => Promise<RespawnPreparation>;
  resetAutoContinue: () => { count: number; stage: string | null };
  scheduler?: WorkerScheduler;
  retryDelayMs?: (attempt: number) => number;
  errors: { cardNotFound: string; cardArchived: string; presetNotFound: string };
};

export function workerEnvironment(
  source: { path: string; hostId: string },
  params: Pick<PresetParams, "environmentKind" | "machineId">,
  forceWorkspaceHost = false,
): ThreadEnvironment {
  if (forceWorkspaceHost || params.environmentKind === "project-default") {
    const hostId = forceWorkspaceHost ? source.hostId : (params.machineId ?? source.hostId);
    return { type: "host" as const, hostId, workspace: { type: "unmanaged" as const, path: source.path } };
  }
  return { type: "project-default" as const };
}

function recordThread(
  deps: WorkerDeps,
  cardId: string,
  threadId: string,
  presetId: string | null,
  reason: string,
): number {
  return recordWorkerThread(deps.db, cardId, threadId, presetId, reason);
}

type LineageInput = {
  rootPath: string;
  dirHash: string;
  threadId: string;
  presetId: string | null;
  reason: string;
};

async function lineage(deps: WorkerDeps, input: LineageInput): Promise<void> {
  try {
    const path = join(input.rootPath, "stelow.json");
    await writeMergedFile(
      deps.bb.sdk.files,
      path,
      input.rootPath,
      (existing) => mergeLineageFile(existing, input.dirHash, {
        threadId: input.threadId,
        presetId: input.presetId,
        endedReason: input.reason,
      }),
    );
  } catch { /* audit-only */ }
}

async function workerEnvironmentOf(
  deps: WorkerDeps,
  card: WorkerCard,
): Promise<WorkerEnvironment | null> {
  if (!card.worker_thread_id) return null;
  try {
    const thread = await deps.bb.sdk.threads.get({ threadId: card.worker_thread_id });
    const environmentId = (thread as { environmentId?: unknown }).environmentId;
    if (typeof environmentId !== "string" || !environmentId) return null;
    const environment = await deps.bb.sdk.environments.get({ environmentId });
    return environment?.status === "ready" && environment.path ? environment : null;
  } catch {
    return null;
  }
}

async function continuingEnvironment(
  deps: WorkerDeps,
  card: WorkerCard,
  fallback: ThreadEnvironment,
): Promise<ThreadEnvironment> {
  const environment = await workerEnvironmentOf(deps, card).catch(() => null);
  return environment?.id ? { type: "reuse", environmentId: environment.id } : fallback;
}

async function linkPreviousWorker(
  deps: WorkerDeps,
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

function fallbackEnvironment(
  card: WorkerCard,
  prepared: Extract<RespawnPreparation, { prompt: string }>,
  params: PresetParams,
): ThreadEnvironment {
  if (!prepared.workspace) return { type: "project-default" as const };
  const source = {
    path: prepared.workspace.path,
    hostId: prepared.workspace.hostId ?? "",
  };
  return workerEnvironment(source, params, card.workspace_kind === "exploratory");
}

type Replacement = {
  card: WorkerCard;
  preset: Preset;
  reason: string;
  options: RespawnOptions | undefined;
  prepared: Extract<RespawnPreparation, { prompt: string }>;
};

async function replaceWorker(
  deps: WorkerDeps,
  replacement: Replacement,
): Promise<{ ok: boolean; threadId: string }> {
  const { card, preset, reason, options, prepared } = replacement;
  const params = deps.presetParams(preset);
  const environment = await continuingEnvironment(
    deps,
    card,
    fallbackEnvironment(card, prepared, params),
  );
  const thread = await replaceCardWorker(deps.bb, {
    projectId: card.project_id,
    environment,
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
  recordThread(deps, card.id, thread.id, preset.id, reason);
  if (card.dir_hash) {
    void lineage(deps, {
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

async function respawn(
  deps: WorkerDeps,
  cardId: string,
  presetId: string,
  reason = "band-swap",
  options?: RespawnOptions,
): Promise<{ ok: boolean; error?: string; threadId?: string }> {
  const card = deps.getCard(cardId);
  if (!card) return { ok: false, error: deps.errors.cardNotFound };
  const preset = deps.getPreset(presetId);
  if (!preset) return { ok: false, error: deps.errors.presetNotFound };
  const prepared = await deps.prepareRespawn(card, preset, reason, options);
  if ("error" in prepared) return { ok: false, error: prepared.error };
  try {
    return await replaceWorker(deps, { card, preset, reason, options, prepared });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Respawn failed.";
    deps.updateCard(cardId, { activity: "error", last_error: message });
    return { ok: false, error: message };
  }
}

function continuationText(card: WorkerCard): string {
  if (card.kind === "research") return "continuing the research";
  if (card.kind === "explore") return "continuing the explore run";
  return `continuing from the ${card.stage} stage`;
}

async function fresh(
  deps: WorkerDeps,
  cardId: string,
  reason: "start" | "restart",
): Promise<{ ok: boolean; error: string | null }> {
  const card = deps.getCard(cardId);
  if (!card) return { ok: false, error: deps.errors.cardNotFound };
  if (card.status === "archived") return { ok: false, error: deps.errors.cardArchived };
  if (reason === "start" && card.worker_thread_id) {
    return { ok: false, error: "This card already has a worker thread." };
  }
  const effective = deps.getReliablePreset(bandForCardKindStage(card.kind, card.stage), cardId);
  const previousThreadId = card.worker_thread_id;
  const result = await respawn(deps, cardId, effective.id, reason);
  if (!result.ok) return { ok: false, error: result.error ?? null };
  const presetName = deps.getPreset(effective.id)?.name ?? effective.id;
  const trail = reason === "start" || !previousThreadId
    ? `Worker started on preset "${presetName}", ${continuationText(card)}.`
    : `Worker restarted on preset "${presetName}", ${continuationText(card)}. Previous worker thread: ${previousThreadId} (archived).`;
  deps.comment(cardId, trail);
  const reset = deps.resetAutoContinue();
  deps.updateCard(cardId, { auto_continue_count: reset.count, auto_continue_stage: reset.stage });
  resetSpawnRetry(deps.db, cardId);
  deps.bb.realtime.publish("card-state", { cardId });
  return { ok: true, error: null };
}

async function failedCause(deps: WorkerDeps, threadId: string): Promise<string | null> {
  try {
    const events = await deps.bb.sdk.threads.events.list({
      threadId,
      types: ["provider/error"],
      order: "desc",
      limit: "5",
    });
    return failureCauseFromEvents(events ?? []);
  } catch {
    return null;
  }
}

function workerFacade(
  deps: WorkerDeps,
  retry: ReturnType<typeof createWorkerRetry>,
  history: ReturnType<typeof createWorkerHistory>,
  respawnScheduler: ReturnType<typeof createRespawnScheduler>,
) {
  return {
    stop: (threadId: string | null) => stopThread(deps.bb, threadId),
    spawnInitial: (args: WorkerSpawnArgs) => spawnCardWorker(deps.bb, args),
    spawnWorkflow: (args: WorkerSpawnArgs) => spawnCardWorker(deps.bb, args),
    replacePrepared: (args: WorkerSpawnArgs, previousThreadId: string | null) =>
      replaceCardWorker(deps.bb, args, previousThreadId),
    recordThread: (cardId: string, threadId: string, presetId: string | null, reason: string) =>
      recordThread(deps, cardId, threadId, presetId, reason),
    lineage: (rootPath: string, dirHash: string, threadId: string, presetId: string | null, reason: string) =>
      lineage(deps, { rootPath, dirHash, threadId, presetId, reason }),
    workerEnvironmentOf: (card: WorkerCard) => workerEnvironmentOf(deps, card),
    continuingEnvironment: (card: WorkerCard, fallback: ThreadEnvironment) =>
      continuingEnvironment(deps, card, fallback),
    respawn: (cardId: string, presetId: string, reason?: string, options?: RespawnOptions) =>
      respawn(deps, cardId, presetId, reason, options),
    fresh: (cardId: string, reason: "start" | "restart") => fresh(deps, cardId, reason),
    scheduleRespawn: respawnScheduler.schedule,
    applyFailed: retry.applyFailed,
    ...history,
    dispose: () => {
      respawnScheduler.dispose();
      retry.dispose();
    },
  };
}

export function createWorkers(deps: WorkerDeps) {
  const scheduler = deps.scheduler ?? defaultWorkerScheduler;
  const retry = createWorkerRetry({
    db: deps.db,
    getCard: deps.getCard,
    updateCard: deps.updateCard,
    comment: deps.comment,
    publish: (cardId) => deps.bb.realtime.publish("card-state", { cardId }),
    fresh: (cardId, reason) => fresh(deps, cardId, reason),
    failedCause: (threadId) => failedCause(deps, threadId),
    scheduler,
    retryDelayMs: deps.retryDelayMs,
  });
  const history = createWorkerHistory(deps.db, deps.bb);
  const respawnScheduler = createRespawnScheduler(
    scheduler,
    (cardId, presetId) => { void respawn(deps, cardId, presetId); },
  );
  return workerFacade(deps, retry, history, respawnScheduler);
}

export type Workers = ReturnType<typeof createWorkers>;

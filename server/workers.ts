import { join } from "node:path";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { failureCauseFromEvents } from "../lib/worker-failure.mjs";
import { recordWorkerThread } from "../lib/worker-ledger.mjs";
import { resetSpawnRetry } from "../lib/spawn-retry.mjs";
import { mergeLineageFile, writeMergedFile } from "../lib/workflow-lineage.mjs";
import { bandForCardKindStage } from "../lib/preset-staleness.mjs";
import { createWorkerHistory } from "./workers-history.js";
import { createWorkerRetry } from "./workers-retry.js";

type Db = ReturnType<BbPluginApi["storage"]["database"]>;
type SpawnArgs = Parameters<BbPluginApi["sdk"]["threads"]["spawn"]>[0];
type ThreadEnvironment = SpawnArgs["environment"];

export type WorkerCard = {
  id: string;
  project_id: string;
  name: string;
  display_name: string | null;
  prompt: string;
  intent: string;
  status: string;
  stage: string;
  activity: string;
  worker_thread_id: string | null;
  worker_preset_id: string | null;
  preset_restart_pending: number | null;
  dir_hash: string | null;
  auto_continue_count: number | null;
  auto_continue_stage: string | null;
  spawn_retry_count: number | null;
  spawn_retry_thread: string | null;
  attachments: string;
  workspace_kind: "project" | "exploratory";
  workspace_path: string | null;
  workspace_host_id: string | null;
  kind: "build" | "research" | "explore";
  research_strategy: string | null;
  research_strategies: string | null;
  explore_stage: string | null;
  last_error: string | null;
  last_assistant_text: string | null;
  last_idle_at: number | null;
  environment_label: string | null;
  created_at: number;
  updated_at: number;
};

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
    stateDir: string | null;
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
  cardWorkspace: (card: WorkerCard) => Promise<{ path: string; hostId: string | null } | null>;
  prepareRespawn: (card: WorkerCard, preset: Preset, reason: string, options?: RespawnOptions) => Promise<RespawnPreparation>;
  resetAutoContinue: () => { count: number; stage: string | null };
  errors: { cardNotFound: string; cardArchived: string; presetNotFound: string };
};

const WORKER_COLUMNS = [
  ["worker_preset_id", "TEXT"],
  ["preset_restart_pending", "INTEGER NOT NULL DEFAULT 0"],
  ["spawn_retry_count", "INTEGER NOT NULL DEFAULT 0"],
  ["spawn_retry_thread", "TEXT"],
  ["environment_label", "TEXT"],
] as const;

export function runWorkerMigrations(db: Db): void {
  const columns = new Set(
    (db.prepare("PRAGMA table_info(cards)").all() as Array<{ name: string }>).map((column) => column.name),
  );
  for (const [name, definition] of WORKER_COLUMNS) {
    if (!columns.has(name)) db.exec(`ALTER TABLE cards ADD COLUMN ${name} ${definition}`);
  }
  db.exec(`CREATE TABLE IF NOT EXISTS card_threads (
    thread_id TEXT PRIMARY KEY,
    card_id TEXT NOT NULL,
    preset_id TEXT,
    started_at INTEGER NOT NULL,
    ended_at INTEGER,
    ended_reason TEXT,
    FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_card_threads_card ON card_threads(card_id, started_at DESC);`);
}

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

export function createWorkers(deps: WorkerDeps) {
  const { db, bb, now } = deps;
  async function spawn(args: SpawnArgs) {
    return bb.sdk.threads.spawn(args);
  }

  async function stop(threadId: string | null): Promise<void> {
    if (!threadId) return;
    try { await bb.sdk.threads.archive({ threadId }); } catch { /* already gone */ }
    try { await bb.sdk.threads.stop({ threadId }); } catch { /* already gone */ }
  }

  function recordThread(cardId: string, threadId: string, presetId: string | null, reason: string): number {
    return recordWorkerThread(db, cardId, threadId, presetId, reason);
  }

  async function lineage(rootPath: string, dirHash: string, threadId: string, presetId: string | null, reason: string): Promise<void> {
    try {
      const path = join(rootPath, "stelow.json");
      await writeMergedFile(bb.sdk.files, path, rootPath, (existing) => mergeLineageFile(existing, dirHash, {
        threadId, presetId, endedReason: reason,
      }));
    } catch { /* audit-only */ }
  }

  async function workerEnvironmentOf(card: WorkerCard): Promise<WorkerEnvironment | null> {
    if (!card.worker_thread_id) return null;
    try {
      const thread = await bb.sdk.threads.get({ threadId: card.worker_thread_id });
      const environmentId = (thread as { environmentId?: unknown }).environmentId;
      if (typeof environmentId !== "string" || !environmentId) return null;
      const environment = await bb.sdk.environments.get({ environmentId });
      return environment?.status === "ready" && environment.path ? environment : null;
    } catch {
      return null;
    }
  }

  async function continuingEnvironment(card: WorkerCard, fallback: ThreadEnvironment): Promise<ThreadEnvironment> {
    const environment = await workerEnvironmentOf(card).catch(() => null);
    return environment?.id ? { type: "reuse", environmentId: environment.id } : fallback;
  }

  async function linkPreviousWorker(
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
      await bb.sdk.threads.send({
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

  async function respawn(
    cardId: string,
    presetId: string,
    reason = "band-swap",
    options?: RespawnOptions,
  ): Promise<{ ok: boolean; error?: string; threadId?: string }> {
    const card = deps.getCard(cardId);
    if (!card) return { ok: false, error: deps.errors.cardNotFound };
    const preset = deps.getPreset(presetId);
    if (!preset) return { ok: false, error: deps.errors.presetNotFound };
    const params = deps.presetParams(preset);
    const prepared = await deps.prepareRespawn(card, preset, reason, options);
    if ("error" in prepared) return { ok: false, error: prepared.error };
    try {
      const source = prepared.workspace
        ? { path: prepared.workspace.path, hostId: prepared.workspace.hostId ?? "" }
        : null;
      const fallback = source
        ? workerEnvironment(source, params, card.workspace_kind === "exploratory")
        : { type: "project-default" as const };
      const environment = await continuingEnvironment(card, fallback);
      // delegation-site: worker-spawn
      const thread = await spawn({
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
      });
      await stop(card.worker_thread_id);
      const timestamp = now();
      deps.updateCard(cardId, {
        worker_thread_id: thread.id,
        worker_preset_id: preset.id,
        preset_restart_pending: 0,
        activity: "running",
        last_error: null,
        updated_at: timestamp,
      });
      recordThread(cardId, thread.id, preset.id, reason);
      if (card.dir_hash) void lineage(prepared.projectPath, card.dir_hash, thread.id, preset.id, reason);
      await linkPreviousWorker(card, thread.id, options?.previousProjectId);
      return { ok: true, threadId: thread.id };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Respawn failed.";
      deps.updateCard(cardId, { activity: "error", last_error: message });
      return { ok: false, error: message };
    }
  }

  async function fresh(cardId: string, reason: "start" | "restart"): Promise<{ ok: boolean; error: string | null }> {
    const card = deps.getCard(cardId);
    if (!card) return { ok: false, error: deps.errors.cardNotFound };
    if (card.status === "archived") return { ok: false, error: deps.errors.cardArchived };
    if (reason === "start" && card.worker_thread_id) return { ok: false, error: "This card already has a worker thread." };
    const effective = deps.getReliablePreset(bandForCardKindStage(card.kind, card.stage), cardId);
    const previousThreadId = card.worker_thread_id;
    const result = await respawn(cardId, effective.id, reason);
    if (!result.ok) return { ok: false, error: result.error ?? null };
    const presetName = deps.getPreset(effective.id)?.name ?? effective.id;
    const continuation = card.kind === "research"
      ? "continuing the research"
      : card.kind === "explore"
        ? "continuing the explore run"
        : `continuing from the ${card.stage} stage`;
    const trail = reason === "start" || !previousThreadId
      ? `Worker started on preset "${presetName}", ${continuation}.`
      : `Worker restarted on preset "${presetName}", ${continuation}. Previous worker thread: ${previousThreadId} (archived).`;
    deps.comment(cardId, trail);
    const reset = deps.resetAutoContinue();
    deps.updateCard(cardId, { auto_continue_count: reset.count, auto_continue_stage: reset.stage });
    resetSpawnRetry(db, cardId);
    bb.realtime.publish("card-state", { cardId });
    return { ok: true, error: null };
  }

  function scheduleRespawn(cardId: string, presetId: string): void {
    setTimeout(() => { void respawn(cardId, presetId); }, 10);
  }

  async function failedCause(threadId: string): Promise<string | null> {
    try {
      const events = await bb.sdk.threads.events.list({
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

  const retry = createWorkerRetry({
    db,
    getCard: deps.getCard,
    updateCard: deps.updateCard,
    comment: deps.comment,
    publish: (cardId) => bb.realtime.publish("card-state", { cardId }),
    fresh,
    failedCause,
  });
  const history = createWorkerHistory(db, bb);

  return {
    spawn,
    stop,
    recordThread,
    lineage,
    workerEnvironmentOf,
    continuingEnvironment,
    respawn,
    fresh,
    scheduleRespawn,
    applyFailed: retry.applyFailed,
    ...history,
    disposeRetries: retry.dispose,
  };
}

export type Workers = ReturnType<typeof createWorkers>;

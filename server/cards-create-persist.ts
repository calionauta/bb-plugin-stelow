import { describeCardEnvironment } from "../lib/tracks.mjs";
import { environmentFallbackNotice } from "../lib/card-environment.mjs";
import type { CardCreateInput, CardsCreateDeps, Preset, Prepared, ResolvedTrack, Workspace } from "./cards-create.js";

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

export const CARD_COLUMNS = [
  "id", "project_id", "name", "display_name", "prompt", "intent", "status", "stage", "activity",
  "worker_thread_id", "worker_preset_id", "dir_hash", "attachments", "workspace_kind", "workspace_path",
  "workspace_host_id", "kind", "research_strategy", "research_strategies", "explore_stage", "last_error",
  "last_assistant_text", "environment_label", "created_at", "updated_at",
];

export async function insertCard(
  deps: CardsCreateDeps,
  input: CardCreateInput,
  cardId: string,
  workspace: Workspace,
  prepared: Prepared,
  track: ResolvedTrack,
  preset: Preset,
  pinnedId: string | null,
  thread: { id: string } | null,
) {
  const timestamp = deps.now();
  const createdAt = new Date(timestamp).toISOString();
  const environmentLabel = describeCardEnvironment({
    exploratory: workspace.exploratory,
    envType: recordOf(prepared.environment).type,
    workspaceType: recordOf(recordOf(prepared.environment).workspace).type,
  });
  const values = cardValues(input, cardId, workspace, prepared, track, preset, thread, environmentLabel, createdAt, timestamp);
  if (values.length !== CARD_COLUMNS.length) throw new Error(`Card insert mismatch: ${values.length} values for ${CARD_COLUMNS.length} columns.`);
  deps.db.prepare(`INSERT INTO cards (${CARD_COLUMNS.join(", ")}) VALUES (${CARD_COLUMNS.map(() => "?").join(", ")})`).run(...values);
  return timestamp;
}

function cardValues(
  input: CardCreateInput,
  cardId: string,
  workspace: Workspace,
  prepared: Prepared,
  track: ResolvedTrack,
  preset: Preset,
  thread: { id: string } | null,
  environmentLabel: string,
  createdAt: string,
  timestamp: number,
): Array<string | number | null> {
  const initialStatus = track.research || track.explore ? "pending" : "draft";
  const stage = track.research ? "research" : track.explore ? "explore" : "triage";
  return [
    cardId,
    workspace.projectId,
    input.prompt
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 50) || "stelow",
    prepared.displayName,
    input.prompt,
    track.intent,
    initialStatus,
    stage,
    input.start === false ? "idle" : "running",
    thread?.id ?? null,
    preset.id, track.seed.dirHash, JSON.stringify(input.attachments), workspace.exploratory ? "exploratory" : "project",
    workspace.exploratory ? workspace.rootPath : null, workspace.exploratory ? workspace.source.hostId : null,
    track.research ? "research" : track.explore ? "explore" : "build",
    track.researchStrategy?.id ?? null,
    track.researchStrategy
      ? JSON.stringify([{ id: track.researchStrategy.id, at: createdAt, file: prepared.roundFile }])
      : null,
    track.exploreStage?.id ?? null, null, null, environmentLabel, timestamp, timestamp,
  ];
}

export async function finishCard(
  deps: CardsCreateDeps,
  input: CardCreateInput,
  cardId: string,
  workspace: Workspace,
  prepared: Prepared,
  track: ResolvedTrack,
  preset: Preset,
  pinnedId: string | null,
  thread: { id: string } | null,
  timestamp: number,
): Promise<{ cardId: string; threadId: string | null }> {
  deps.recordStageEvent(cardId, track.research ? "research" : track.explore ? "explore" : "triage");
  if (pinnedId && !deps.pinCardPreset(cardId, pinnedId, timestamp)) {
    throw new Error("Card preset disappeared before creation completed.");
  }
  if (thread) {
    deps.recordThread(cardId, thread.id, preset.id, "initial");
    if (track.seed.dirHash) void deps.lineage(workspace.rootPath, track.seed.dirHash, thread.id, preset.id, "initial");
  }
  if (!track.research && !track.explore) {
    await deps.bb.storage.kv.set("board-workflow-defaults", {
      appetite: input.appetite,
      reviewMode: track.reviewRung,
      reviewGates: track.reviewGates,
    });
  }
  logEnvironmentNotice(deps, input, cardId, workspace, prepared);
  deps.bb.realtime.publish("card-state", { cardId });
  void deps.suggestCardName(cardId).catch(() => undefined);
  return { cardId, threadId: thread?.id ?? null };
}

function logEnvironmentNotice(
  deps: CardsCreateDeps,
  input: CardCreateInput,
  cardId: string,
  workspace: Workspace,
  prepared: Prepared,
): void {
  if (workspace.exploratory) return;
  const notice = environmentFallbackNotice(input.environment, prepared.environment);
  if (!notice) return;
  deps.bb.log.warn(`card ${cardId}: ${notice}`);
  deps.comment(cardId, notice);
}

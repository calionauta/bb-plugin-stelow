import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { bandForCardKindStage } from "../../lib/preset-staleness.mjs";
import { researchStrategyById } from "../../lib/research-strategies.mjs";
import { techniqueById } from "../../lib/stage-catalog.mjs";
import { isArchivedCard } from "../../lib/worker-action-policy.mjs";
import { freshStatusForReseed, resolveReseedIntent } from "../../lib/workflow-intent-policy.mjs";
import type { PresetRow } from "../presets.js";
import type { WorkerCard, WorkerSpawnArgs } from "../workers-types.js";
import type { PresetParams } from "../workers.js";
import type {
  ExploreWorkerPromptInput,
  ResearchWorkerPromptInput,
} from "./track-prompts.js";
import { buildReseedPrompt } from "./card-reseed-prompt.js";

type Db = ReturnType<BbPluginApi["storage"]["database"]>;
type Workspace = { path: string; hostId: string | null };
type Source = { path: string; hostId: string };
type SeedResult = {
  error: string | null;
  dirHash?: string | null;
  stateDir?: string | null;
};
type Protocols = {
  cardOwnerRules: string;
  neverSeed: string;
  cliEquivalents: string;
  reconProtocol: string;
  draftProtocol: string;
  turnDiscipline: string;
  commitStyle: string;
  interfacePick: string;
  doneProtocol: string;
  splitProtocol: string;
};
type ReseedDeps = {
  db: Db;
  bb: BbPluginApi;
  now: () => number;
  getCard: (cardId: string) => WorkerCard | undefined;
  cardWorkspace: (card: WorkerCard) => Promise<Workspace | null>;
  workflowStateDir: (rootPath: string, card: WorkerCard) => Promise<string | null>;
  readStateConfig: (rootPath: string, card: WorkerCard) => Promise<{
    appetite?: string | null;
    reviewGates?: string[] | null;
  } | null>;
  seedWorkflow: (args: {
    rootPath: string;
    card: WorkerCard;
    intent: string;
    appetite: string;
    reviewGates: string[];
  }) => Promise<SeedResult>;
  getPresetById: (presetId: string) => PresetRow | null;
  pinCardPreset: (cardId: string, presetId: string) => boolean;
  getReliablePreset: (band: string, cardId: string) => PresetRow;
  presetParams: (preset: PresetRow) => PresetParams;
  strategyList: (card: WorkerCard) => string[];
  strategyRounds: (card: WorkerCard) => Array<{ id: string; file: string }>;
  roundFile: (strategyId: string, roundNo: number, stamp: string) => string;
  roundStamp: () => string;
  roundRelativePath: (stateDir: string, rootPath: string, file: string) => string;
  ensureArtifactParent: (rootPath: string, file: string) => Promise<void>;
  researchPrompt: (input: ResearchWorkerPromptInput) => string;
  explorePrompt: (input: ExploreWorkerPromptInput) => string;
  attachments: (raw: string) => NonNullable<WorkerSpawnArgs["input"]>;
  continuingEnvironment: (
    card: WorkerCard,
    environment: WorkerSpawnArgs["environment"],
  ) => Promise<WorkerSpawnArgs["environment"]>;
  workerEnvironment: (
    source: Source,
    params: PresetParams,
    exploratory: boolean,
  ) => WorkerSpawnArgs["environment"];
  replacePrepared: (
    args: WorkerSpawnArgs,
    previousThreadId: string | null,
  ) => Promise<{ id: string }>;
  resetAutoContinue: () => { count: number; stage: string | null };
  updateCard: (cardId: string, fields: Record<string, unknown>) => void;
  recordThread: (cardId: string, threadId: string, presetId: string, reason: string) => void;
  lineage: (rootPath: string, dirHash: string, threadId: string, presetId: string, reason: string) => Promise<unknown>;
  publishCard: (cardId: string) => void;
  protocols: Protocols;
  errors: {
    cardNotFound: string;
    cardArchived: string;
    workspaceUnavailable: string;
    presetNotFound: string;
  };
};

export function createCardReseed(deps: ReseedDeps) {
  return (input: { cardId: string; presetId?: string | null; intent?: string }) =>
    reseedCard(deps, input);
}

async function reseedCard(
  deps: ReseedDeps,
  input: { cardId: string; presetId?: string | null; intent?: string },
) {
  const card = deps.getCard(input.cardId);
  if (!card) return reseedFailure(deps.errors.cardNotFound);
  if (isArchivedCard(card)) return reseedFailure(deps.errors.cardArchived);
  const decision = resolveReseedIntent(card, input.intent);
  if (!decision) return reseedFailure("Only Build cards use a workflow type.");
  const workspace = await deps.cardWorkspace(card);
  if (!workspace?.hostId || !workspace.path) {
    return reseedFailure(`${deps.errors.workspaceUnavailable} Archive this card to remove it.`);
  }
  const source: Source = { path: workspace.path, hostId: workspace.hostId };
  const config = await deps.readStateConfig(source.path, card);
  const seed = await deps.seedWorkflow({
    rootPath: source.path,
    card,
    intent: decision.intent,
    appetite: config?.appetite ?? "Core",
    reviewGates: config?.reviewGates ?? [],
  });
  if (seed.error) return reseedFailure(seed.error);
  updateReseedIdentity(deps, input.cardId, seed);
  const preset = resolvePreset(deps, input.cardId, input.presetId, card);
  if ("error" in preset) return reseedFailure(preset.error);
  const track = await resolveTrack(deps, card, seed, source.path, decision.reclassified);
  if ("error" in track) return reseedFailure(track.error);
  const thread = await replaceReseedWorker(deps, card, source, seed, preset, track, decision.intent);
  deps.db.prepare("UPDATE cards SET intent = ?, updated_at = ? WHERE id = ?")
    .run(decision.intent, deps.now(), input.cardId);
  applyReseedState(deps, input.cardId, card, preset.id, thread.id, decision.reclassified);
  deps.recordThread(input.cardId, thread.id, preset.id, "reseed");
  recordReseedLineage(deps, source.path, seed, thread.id, preset.id);
  deps.publishCard(input.cardId);
  return { reseeded: true, error: null, reclassified: decision.reclassified };
}

function reseedFailure(error: string, reclassified = false) {
  return { reseeded: false, error, reclassified };
}

function updateReseedIdentity(deps: ReseedDeps, cardId: string, seed: SeedResult): void {
  if (!seed.dirHash) return;
  deps.db.prepare("UPDATE cards SET dir_hash = ?, updated_at = ? WHERE id = ?")
    .run(seed.dirHash, deps.now(), cardId);
  deps.db.prepare("DELETE FROM ask_contracts WHERE card_id = ?").run(cardId);
}

function resolvePreset(
  deps: ReseedDeps,
  cardId: string,
  presetId: string | null | undefined,
  card: WorkerCard,
): PresetRow | { error: string } {
  if (!presetId) {
    return deps.getReliablePreset(bandForCardKindStage(card.kind, card.stage), cardId);
  }
  const preset = deps.getPresetById(presetId);
  if (!preset || !deps.pinCardPreset(cardId, preset.id)) {
    return { error: deps.errors.presetNotFound };
  }
  return preset;
}

async function resolveTrack(
  deps: ReseedDeps,
  card: WorkerCard,
  seed: SeedResult,
  rootPath: string,
  reclassified: boolean,
): Promise<{
  research: ReturnType<typeof researchStrategyById>;
  explore: ReturnType<typeof techniqueById>;
  roundNo: number;
  roundStamp: string;
  roundFile: string;
  reclassified: boolean;
} | { error: string }> {
  const research = card.kind === "research" ? researchStrategyById(card.research_strategy ?? "") : null;
  if (card.kind === "research" && !research) {
    return { error: "This research has no known strategy. Archive it and start a new one." };
  }
  const explore = card.kind === "explore" ? techniqueById(card.explore_stage ?? "") : null;
  if (card.kind === "explore" && !explore) {
    return { error: "This explore card has no known technique. Archive it and start a new one." };
  }
  const roundNo = Math.max(1, deps.strategyList(card).length);
  const roundStamp = deps.roundStamp();
  const roundFile = await researchRoundFile(deps, card, seed, rootPath, research?.id, roundNo, roundStamp);
  return { research, explore, roundNo, roundStamp, roundFile, reclassified };
}

async function researchRoundFile(
  deps: ReseedDeps,
  card: WorkerCard,
  seed: SeedResult,
  rootPath: string,
  strategyId: string | undefined,
  roundNo: number,
  stamp: string,
): Promise<string> {
  if (!strategyId) return "";
  const previous = [...deps.strategyRounds(card)].reverse().find((entry) => entry.id === strategyId)?.file;
  const file = previous ?? (seed.stateDir
    ? deps.roundRelativePath(seed.stateDir, rootPath, deps.roundFile(strategyId, roundNo, stamp))
    : "");
  if (file) await deps.ensureArtifactParent(rootPath, file);
  return file;
}

async function replaceReseedWorker(
  deps: ReseedDeps,
  card: WorkerCard,
  source: Source,
  seed: SeedResult,
  preset: PresetRow,
  track: Awaited<ReturnType<typeof resolveTrack>>,
  intent: string,
): Promise<{ id: string }> {
  if ("error" in track) throw new Error("Reseed track must be resolved before replacement.");
  const params = deps.presetParams(preset);
  const fallback = deps.workerEnvironment(
    source,
    params,
    card.workspace_kind === "exploratory",
  );
  const environment = await deps.continuingEnvironment(card, fallback);
  const args = reseedSpawnArgs(
    deps,
    card,
    source,
    seed,
    params,
    environment,
    track,
    intent,
  );
  return deps.replacePrepared(args, card.worker_thread_id);
}

function reseedSpawnArgs(
  deps: ReseedDeps,
  card: WorkerCard,
  source: Source,
  seed: SeedResult,
  params: PresetParams,
  environment: WorkerSpawnArgs["environment"],
  track: Awaited<ReturnType<typeof resolveTrack>>,
  intent: string,
): WorkerSpawnArgs {
  if ("error" in track) throw new Error("Reseed track must be resolved before replacement.");
  return {
    projectId: card.project_id,
    environment,
    visibility: "hidden",
    title: `Stelow: ${card.display_name ?? card.name}`,
    providerId: params.providerId,
    model: params.modelId,
    reasoningLevel: params.reasoningLevel as WorkerSpawnArgs["reasoningLevel"],
    permissionMode: params.permissionMode as WorkerSpawnArgs["permissionMode"],
    executionInputSources: explicitSources(),
    input: [
      {
        type: "text",
        mentions: [],
        text: buildReseedPrompt({
          card,
          rootPath: source.path,
          intent,
          seed,
          params,
          protocols: deps.protocols,
          research: track.research,
          explore: track.explore,
          roundNo: track.roundNo,
          roundStamp: track.roundStamp,
          roundFile: track.roundFile,
          researchPrompt: deps.researchPrompt,
          explorePrompt: deps.explorePrompt,
        }),
      },
      ...deps.attachments(card.attachments),
    ],
  };
}

function explicitSources() {
  return {
    providerId: "explicit" as const,
    model: "explicit" as const,
    reasoningLevel: "explicit" as const,
    permissionMode: "explicit" as const,
  };
}

function applyReseedState(
  deps: ReseedDeps,
  cardId: string,
  card: WorkerCard,
  presetId: string,
  threadId: string,
  reclassified: boolean,
): void {
  const reset = deps.resetAutoContinue();
  deps.updateCard(cardId, {
    stage: card.kind === "research" ? "research" : card.kind === "explore" ? "explore" : "triage",
    status: freshStatusForReseed(card, reclassified),
    activity: "running",
    last_error: null,
    worker_thread_id: threadId,
    worker_preset_id: presetId,
    preset_restart_pending: 0,
    last_assistant_text: null,
    auto_continue_count: reset.count,
    auto_continue_stage: reset.stage,
  });
}

function recordReseedLineage(
  deps: ReseedDeps,
  rootPath: string,
  seed: SeedResult,
  threadId: string,
  presetId: string,
): void {
  if (seed.dirHash) {
    void deps.lineage(rootPath, seed.dirHash, threadId, presetId, "reseed");
  }
}

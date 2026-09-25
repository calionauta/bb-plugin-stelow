import { researchStrategyById } from "../../lib/research-strategies.mjs";
import { roundFileName, roundTimestamp } from "../../lib/research-rounds.mjs";
import { techniqueById } from "../../lib/stage-catalog.mjs";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { PresetParams, RespawnOptions, RespawnPreparation } from "../workers.js";
import type { WorkerCard } from "../workers-types.js";
import type {
  ExploreWorkerPromptInput,
  ResearchWorkerPromptInput,
} from "./track-prompts.js";
import { buildWorkerRestartPrompt } from "./worker-restart-prompt.js";

type Workspace = { path: string; hostId: string | null };
type ResearchStrategy = NonNullable<ReturnType<typeof researchStrategyById>>;
type ExploreStage = NonNullable<ReturnType<typeof techniqueById>>;
type Round = { id: string; file: string };
type WorkerPreset = {
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

type RestartProtocols = Parameters<typeof buildWorkerRestartPrompt>[0]["protocols"];

type WorkerRespawnDeps = {
  bb: BbPluginApi;
  presetParams: (preset: WorkerPreset) => PresetParams;
  cardWorkspace: (card: WorkerCard) => Promise<Workspace | null>;
  workflowStateDir: (
    bb: BbPluginApi,
    rootPath: string,
    workflowId: string,
    dirHash: string,
  ) => Promise<string | null>;
  strategyList: (card: WorkerCard) => string[];
  strategyRounds: (card: WorkerCard) => Round[];
  researchWorkerPrompt: (input: ResearchWorkerPromptInput) => string;
  exploreWorkerPrompt: (input: ExploreWorkerPromptInput) => string;
  roundRelPath: (stateDir: string, projectPath: string, file: string) => string;
  text: (value: string | null) => string;
  protocols: RestartProtocols;
};

type TrackContext = {
  card: WorkerCard;
  stateDir: string | null;
  projectPath: string;
  options?: RespawnOptions;
  research: ResearchStrategy | null;
  explore: ExploreStage | null;
  respawnRoundNo: number;
  respawnStamp: string;
};

type RespawnWork = TrackContext & { roundFile: string };

export function createWorkerRespawnPreparation<Preset extends WorkerPreset>(deps: WorkerRespawnDeps) {
  return async (
    card: WorkerCard,
    preset: Preset,
    _reason: string,
    options?: RespawnOptions,
  ): Promise<RespawnPreparation> => prepareWorkerRespawn(deps, card, preset, options);
}

async function prepareWorkerRespawn<Preset extends WorkerPreset>(
  deps: WorkerRespawnDeps,
  card: WorkerCard,
  preset: Preset,
  options?: RespawnOptions,
): Promise<RespawnPreparation> {
  const params = deps.presetParams(preset);
  const workspace = await deps.cardWorkspace(card);
  const projectPath = workspace?.path ?? "";
  const stateDir = await verifiedStateDir(deps, card, projectPath);
  if (card.dir_hash && !stateDir) return unverifiableStateRefusal();
  const stateHint = deps.text(stateHintFor(card, stateDir));
  const track = trackContext(deps.strategyList, card, stateDir, projectPath, options);
  if (card.kind === "research" && !track.research) {
    return { error: "This research has no known strategy. Archive it and start a new one." };
  }
  if (card.kind === "explore" && !track.explore) {
    return { error: "This explore card has no known technique. Archive it and start a new one." };
  }
  const work: RespawnWork = {
    ...track,
    roundFile: await researchRoundFile(deps, track),
  };
  const prompt = trackPrompt(deps, work, params, stateHint);
  return { prompt, projectPath, workspace };
}

async function verifiedStateDir(
  deps: WorkerRespawnDeps,
  card: WorkerCard,
  projectPath: string,
): Promise<string | null> {
  if (!card.dir_hash || !projectPath) return null;
  return deps.workflowStateDir(deps.bb, projectPath, card.id, card.dir_hash).catch(() => null);
}

function unverifiableStateRefusal(): RespawnPreparation {
  return {
    error: "This card's workflow state cannot be verified. Reseed it before restarting its worker.",
  };
}

function stateHintFor(card: WorkerCard, stateDir: string | null): string {
  if (stateDir) return stateDir;
  if (card.dir_hash) return `.stelow/<date>/${card.dir_hash}`;
  return "<project>/.stelow/<date>/<dirHash>";
}

function trackContext(
  strategyList: (card: WorkerCard) => string[],
  card: WorkerCard,
  stateDir: string | null,
  projectPath: string,
  options?: RespawnOptions,
): TrackContext {
  const history = strategyList(card);
  const runStrategyId = card.kind === "research"
    ? options?.strategyId ?? history[history.length - 1] ?? card.research_strategy ?? ""
    : null;
  return {
    card,
    stateDir,
    projectPath,
    options,
    research: card.kind === "research" ? researchStrategyById(runStrategyId ?? "") : null,
    explore: card.kind === "explore" ? techniqueById(card.explore_stage ?? "") : null,
    respawnRoundNo: options?.roundNo ?? Math.max(1, history.length),
    respawnStamp: options?.roundStamp ?? roundTimestamp(),
  };
}

async function researchRoundFile(
  deps: WorkerRespawnDeps,
  track: TrackContext,
): Promise<string> {
  if (track.options?.roundFile) return track.options.roundFile;
  if (!track.research) return "";
  const existing = [...deps.strategyRounds(track.card)]
    .reverse()
    .find((entry) => entry.id === track.research?.id)?.file;
  if (existing) return existing;
  if (!track.stateDir || !track.projectPath) return "";
  return deps.roundRelPath(
    track.stateDir,
    track.projectPath,
    roundFileName(track.research.id, track.respawnRoundNo, track.respawnStamp),
  );
}

function trackPrompt(
  deps: WorkerRespawnDeps,
  work: RespawnWork,
  params: PresetParams,
  stateHint: string,
): string {
  const card = work.card;
  const base = {
    displayName: card.display_name ?? card.name,
    prompt: card.prompt,
    stateDirText: stateHint,
    workspaceRoot: work.projectPath || "<workspace>",
    instructions: params.instructions,
  };
  if (work.research) {
    return deps.researchWorkerPrompt({
      ...base,
      strategyLabel: work.research.label,
      strategyId: work.research.id,
      strategySkill: work.research.skill,
      flavor: work.options?.flavor ?? "restart",
      previousThreadId: card.worker_thread_id,
      roundNo: work.respawnRoundNo,
      roundStamp: work.respawnStamp,
      roundFile: work.roundFile,
    });
  }
  if (work.explore) {
    return deps.exploreWorkerPrompt({
      ...base,
      stage: work.explore,
      flavor: "restart",
      previousThreadId: card.worker_thread_id,
    });
  }
  return buildWorkerRestartPrompt({
    card,
    instructions: params.instructions,
    stateHint,
    stateDir: work.stateDir,
    protocols: deps.protocols,
  });
}

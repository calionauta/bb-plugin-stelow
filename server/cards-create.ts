import { mkdirSync } from "node:fs";
import { join as nodeJoin } from "node:path";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { composerPresetOverride, composerSpawnInput } from "../lib/composer-execution.mjs";
import { selectCardEnvironment } from "../lib/card-environment.mjs";
import { heuristicDisplayName } from "../lib/draft-burst.mjs";
import { bandForKind } from "../lib/tracks.mjs";
import { normalizeBuildSeedIntent } from "../lib/workflow-intent-policy.mjs";
import { formatReviewGates, legacyLabelForGates, normalizeReviewGates } from "../lib/review-gates.mjs";
import type { CardPromptRules } from "./cards-create-prompt.js";
import { buildBuildPrompt } from "./cards-create-prompt.js";
import { workerEnvironment } from "./workers.js";
import { finishCard, insertCard } from "./cards-create-persist.js";

export type CardCreateInput = {
  projectId: string;
  environment?: unknown;
  prompt: string;
  attachments: Array<{ path: string; type: "localFile" | "localImage" }>;
  intent: string;
  appetite: string;
  reviewMode: string | string[];
  presetId?: string | null;
  kind?: "build" | "research" | "explore";
  strategy?: string | null;
  stageId?: string | null;
  start?: boolean;
  execution?: {
    providerId?: string;
    model?: string;
    reasoningLevel?: string;
    permissionMode?: "accept-edits" | "auto" | "full";
    serviceTier?: "default" | "fast";
    executionInputSources?: {
      providerId?: "explicit" | "client-preference";
      model?: "explicit" | "client-preference";
      reasoningLevel?: "explicit" | "client-preference";
      permissionMode?: "explicit" | "client-preference";
      serviceTier?: "explicit" | "client-preference";
    };
  } | null;
};

type Db = ReturnType<BbPluginApi["storage"]["database"]>;
type SpawnArgs = Parameters<BbPluginApi["sdk"]["threads"]["spawn"]>[0];
export type Preset = {
  id: string;
  provider_id: string;
  model_id: string;
  reasoning_level: string;
  permission_mode: string;
  environment_kind: string;
  base_branch: string | null;
  machine_id: string | null;
  instructions: string;
};
type PresetParams = {
  providerId: string;
  modelId: string;
  reasoningLevel: string;
  permissionMode: string;
  environmentKind: string;
  machineId: string | null;
  instructions: string;
};
type Seed = {
  error: string | null;
  dirHash: string | null;
  stateDir: string | null;
};
export type Workspace = { projectId: string; rootPath: string; source: { path: string; hostId: string }; exploratory: boolean };
export type ResolvedTrack = {
  research: boolean;
  explore: boolean;
  researchStrategy: ReturnType<typeof import("../lib/research-strategies.mjs").researchStrategyById>;
  exploreStage: ReturnType<typeof import("../lib/stage-catalog.mjs").techniqueById>;
  intent: string;
  reviewGates: string[];
  reviewRung: string;
  seed: Seed;
};
type ExploreStage = ReturnType<typeof import("../lib/stage-catalog.mjs").techniqueById>;
export type Prepared = Awaited<ReturnType<typeof preparePrompts>>;

export type CardsCreateDeps = {
  db: Db;
  bb: BbPluginApi;
  now: () => number;
  randomId: (prefix: string) => string;
  roundTimestamp: () => string;
  seedBuildIntent: (prompt: string, projectId: string | null) => Promise<string>;
  seedWorkflow: (bb: BbPluginApi, rootPath: string, cardId: string, slug: string, intent: string, appetite: string, reviewGates: string[]) => Promise<Seed>;
  researchStrategy: (id: string) => ReturnType<typeof import("../lib/research-strategies.mjs").researchStrategyById>;
  exploreStage: (id: string) => ExploreStage;
  researchIds: () => string[];
  exploreIds: () => string[];
  defaultPreset: () => Preset;
  getPreset: (id: string) => Preset | null;
  presetParams: (preset: Preset) => PresetParams;
  spawnInitial: (args: SpawnArgs) => Promise<{ id: string }>;
  recordThread: (cardId: string, threadId: string, presetId: string | null, reason: string) => void;
  lineage: (rootPath: string, dirHash: string, threadId: string, presetId: string | null, reason: string) => Promise<void>;
  roundPath: (stateDir: string, rootPath: string, file: string) => string;
  roundFile: (strategyId: string, roundNo: number, stamp: string) => string;
  ensureParent: (rootPath: string, relativePath: string) => Promise<void>;
  researchPrompt: (input: Record<string, unknown>) => string;
  explorePrompt: (input: Record<string, unknown>) => string;
  rules: CardPromptRules;
  describeManagedWorktree: (environment: unknown) => boolean;
  recordStageEvent: (cardId: string, stage: string) => void;
  comment: (cardId: string, body: string) => void;
  suggestCardName: (cardId: string) => Promise<void>;
};

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

async function resolveWorkspace(
  deps: CardsCreateDeps,
  input: CardCreateInput,
  cardId: string,
): Promise<Workspace> {
  const project = await deps.bb.sdk.projects.get({ projectId: input.projectId }).catch(() => null);
  const exploratory = input.projectId === "proj_personal" || project?.kind === "personal";
  if (exploratory && (input.kind ?? "build") === "build") {
    throw new Error(
      "Build cards require a project workspace with a Git source. "
      + "Choose the code project in BB before starting; use Research or Explore "
      + "for personal, document-only work.",
    );
  }
  const projectSource = project?.sources.find((entry) => entry.isDefault) ?? project?.sources[0];
  if (!exploratory && !projectSource?.path) throw new Error("Project workspace path is unavailable.");
  return resolveExploratoryWorkspace(deps, input, cardId, projectSource, exploratory);
}

async function resolveExploratoryWorkspace(
  deps: CardsCreateDeps,
  input: CardCreateInput,
  cardId: string,
  projectSource: { path: string; hostId: string } | undefined,
  exploratory: boolean,
): Promise<Workspace> {
  const workspace = { projectId: input.projectId, rootPath: projectSource?.path ?? "", source: projectSource, exploratory };
  if (!exploratory) return requireWorkspace(workspace);
  const requestedHostId = typeof recordOf(input.environment).hostId === "string" ? recordOf(input.environment).hostId as string : null;
  const hosts = await deps.bb.sdk.hosts.list();
  if (hosts.length !== 1) throw new Error("Exploratory work currently requires a single local BB host.");
  const hostId = hosts[0]?.id ?? null;
  if (requestedHostId && requestedHostId !== hostId) throw new Error("Exploratory work currently requires the local host.");
  if (!hostId) return requireWorkspace(workspace);
  const rootPath = nodeJoin(process.env.HOME ?? "/tmp", ".bb", "stelow", "exploratory", cardId);
  mkdirSync(rootPath, { recursive: true });
  const basePath = nodeJoin(process.env.HOME ?? "/tmp", ".bb", "stelow", "exploratory");
  const projects = await deps.bb.sdk.projects.list();
  const existing = projects.find((entry) => entry.name === "Stelow exploratory work"
    && entry.sources.some((candidate) => candidate.hostId === hostId && candidate.path === basePath));
  const exploratoryProject = existing ?? await deps.bb.sdk.projects.create({
    name: "Stelow exploratory work",
    source: { type: "local_path", hostId, path: basePath },
  });
  return { projectId: exploratoryProject.id, rootPath, source: { path: rootPath, hostId }, exploratory: true };
}

function requireWorkspace(workspace: {
  projectId: string;
  rootPath: string;
  source: { path: string; hostId: string } | undefined;
  exploratory: boolean;
}): Workspace {
  if (!workspace.rootPath || !workspace.source) throw new Error("A workspace path is unavailable for this card.");
  return workspace as Workspace;
}

async function resolveTrack(
  deps: CardsCreateDeps,
  input: CardCreateInput,
  workspace: Workspace,
  slug: string,
  cardId: string,
) {
  const research = input.kind === "research";
  const explore = input.kind === "explore";
  const researchStrategy = research ? deps.researchStrategy(input.strategy ?? "") : null;
  if (research && !researchStrategy) {
    throw new Error(`Unknown research strategy "${input.strategy ?? ""}". Pick one of: ${deps.researchIds().join(", ")}.`);
  }
  const exploreStage = explore ? deps.exploreStage(input.stageId ?? "") : null;
  if (explore && !exploreStage) {
    throw new Error(`Unknown explore technique "${input.stageId ?? ""}". Pick one of: ${deps.exploreIds().join(", ")}.`);
  }
  const explicitIntent = normalizeBuildSeedIntent(input.intent);
  const intent = research ? "investigate" : explore ? "explore"
    : explicitIntent !== "unknown" ? explicitIntent
      : await deps.seedBuildIntent(input.prompt, workspace.projectId);
  const reviewGates = normalizeReviewGates(input.reviewMode);
  const reviewRung = legacyLabelForGates(reviewGates)
    ?? (reviewGates.length === 0 ? "Auto" : `Custom ${formatReviewGates(reviewGates)}`);
  const seed = await deps.seedWorkflow(
    deps.bb,
    workspace.rootPath,
    cardId,
    slug,
    intent,
    input.appetite,
    reviewGates,
  );
  if (seed.error) throw new Error(seed.error);
  return { research, explore, researchStrategy, exploreStage, intent, reviewGates, reviewRung, seed };
}

function resolvePreset(
  deps: CardsCreateDeps,
  input: CardCreateInput,
  cardId: string,
) {
  const selected = input.presetId ? (deps.getPreset(input.presetId) ?? deps.defaultPreset()) : deps.defaultPreset();
  const band = deps.db.prepare("SELECT preset_id FROM stage_presets WHERE band = ?")
    .get(bandForKind(input.kind ?? "build")) as { preset_id: string } | undefined;
  const reliable = deps.db.prepare("SELECT preset_id FROM reliable_preset WHERE id = 1")
    .get() as { preset_id: string } | undefined;
  const bandPreset = band ? deps.getPreset(band.preset_id) : null;
  const reliablePreset = reliable ? deps.getPreset(reliable.preset_id) : null;
  const base = reliablePreset ?? bandPreset ?? selected;
  const override = composerPresetOverride(base, input.execution ?? null);
  if (!override?.providerId || !override.modelId || !override.reasoningLevel || !override.permissionMode) {
    return { preset: base, pinnedId: null };
  }
  pinPreset(deps, cardId, base, override);
  const preset = deps.getPreset(`card-override-${cardId}`) ?? base;
  return { preset, pinnedId: preset.id === base.id ? null : preset.id };
}

function pinPreset(
  deps: CardsCreateDeps,
  cardId: string,
  preset: Preset,
  override: NonNullable<ReturnType<typeof composerPresetOverride>>,
): void {
  if (!override.providerId || !override.modelId || !override.reasoningLevel || !override.permissionMode) return;
  const timestamp = deps.now();
  deps.db.prepare(
    "INSERT OR REPLACE INTO presets "
      + "(id, name, provider_id, model_id, reasoning_level, permission_mode, "
      + "environment_kind, base_branch, machine_id, instructions, is_default, "
      + "built_in, created_at, updated_at) VALUES "
      + "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?)",
  ).run(
    `card-override-${cardId}`,
    `Card override ${cardId}`,
    override.providerId,
    override.modelId,
    override.reasoningLevel,
    override.permissionMode,
    preset.environment_kind,
    preset.base_branch,
    preset.machine_id,
    preset.instructions,
    timestamp,
    timestamp,
  );
}

async function preparePrompts(
  deps: CardsCreateDeps,
  input: CardCreateInput,
  workspace: Workspace,
  track: ResolvedTrack,
  slug: string,
  preset: Preset,
) {
  const displayName = heuristicDisplayName(input.prompt, slug);
  const params = deps.presetParams(preset);
  const environment = workspace.exploratory
    ? workerEnvironment(workspace.source, params, true)
    : selectCardEnvironment(input.environment, workerEnvironment(workspace.source, params));
  const creationStamp = deps.roundTimestamp();
  const roundFile = track.research && track.researchStrategy && track.seed.stateDir
    ? deps.roundPath(track.seed.stateDir, workspace.rootPath, deps.roundFile(track.researchStrategy.id, 1, creationStamp))
    : "";
  if (roundFile) await deps.ensureParent(workspace.rootPath, roundFile);
  return {
    displayName,
    params,
    environment,
    roundFile,
    prompt: await promptForTrack(
      deps,
      input,
      workspace,
      track,
      displayName,
      params.instructions,
      environment,
      creationStamp,
      roundFile,
    ),
  };
}

async function promptForTrack(
  deps: CardsCreateDeps,
  input: CardCreateInput,
  workspace: Workspace,
  track: ResolvedTrack,
  displayName: string,
  instructions: string | null,
  environment: unknown,
  creationStamp: string,
  roundFile: string,
): Promise<string> {
  const shared = {
    displayName,
    prompt: input.prompt,
    stateDirText: textValue(track.seed.stateDir),
    workspaceRoot: workspace.rootPath,
    instructions,
    flavor: "initial",
    previousThreadId: null,
  };
  if (track.research && track.researchStrategy) {
    return deps.researchPrompt({
      ...shared,
      strategyLabel: track.researchStrategy.label,
      strategyId: track.researchStrategy.id,
      strategySkill: track.researchStrategy.skill,
      roundNo: 1,
      roundStamp: creationStamp,
      roundFile,
    });
  }
  if (track.explore && track.exploreStage) return deps.explorePrompt({ ...shared, stage: track.exploreStage });
  return buildBuildPrompt({
    stateDir: textValue(track.seed.stateDir),
    intent: track.intent,
    managedWorktree: deps.describeManagedWorktree(environment),
    appetite: input.appetite,
    reviewGates: formatReviewGates(track.reviewGates),
    reviewRung: track.reviewRung,
    instructions,
    prompt: input.prompt,
  }, deps.rules);
}

function textValue(value: string | null | undefined): string {
  return value ?? "<project>/.stelow/<date>/<dirHash>";
}

async function spawnInitial(
  deps: CardsCreateDeps,
  input: CardCreateInput,
  workspace: Workspace,
  prepared: Awaited<ReturnType<typeof preparePrompts>>,
): Promise<{ id: string } | null> {
  if (input.start === false) return null;
  const execution = composerSpawnInput(prepared.params, input.execution ?? null);
  return await deps.spawnInitial({
    projectId: workspace.projectId,
    environment: prepared.environment as SpawnArgs["environment"],
    visibility: "hidden",
    title: `Stelow: ${prepared.displayName}`,
    providerId: execution.providerId ?? prepared.params.providerId,
    model: execution.model ?? prepared.params.modelId,
    reasoningLevel: (execution.reasoningLevel ?? prepared.params.reasoningLevel) as SpawnArgs["reasoningLevel"],
    permissionMode: (execution.permissionMode ?? prepared.params.permissionMode) as SpawnArgs["permissionMode"],
    ...(execution.serviceTier ? { serviceTier: execution.serviceTier } : {}),
    executionInputSources: execution.executionInputSources,
    input: [
      { type: "text", mentions: [], text: prepared.prompt },
      ...input.attachments.map((attachment) => ({ type: attachment.type, path: attachment.path })),
    ],
  });
}

export function createCardInternal(deps: CardsCreateDeps) {
  return async (input: CardCreateInput): Promise<{ cardId: string; threadId: string | null }> => {
    const cardId = deps.randomId("card");
    const workspace = await resolveWorkspace(deps, input, cardId);
    const slug = input.prompt.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50) || "stelow";
    const track = await resolveTrack(deps, input, workspace, slug, cardId);
    const resolvedPreset = resolvePreset(deps, input, cardId);
    const prepared = await preparePrompts(deps, input, workspace, track, slug, resolvedPreset.preset);
    const trackWithEnvironment = { ...track, preset: resolvedPreset.preset, environment: prepared.environment };
    let thread: { id: string } | null = null;
    try {
      thread = await spawnInitial(deps, input, workspace, prepared);
    } catch (error) {
      if (resolvedPreset.pinnedId) deps.db.prepare("DELETE FROM presets WHERE id = ?").run(resolvedPreset.pinnedId);
      throw error;
    }
    const timestamp = await insertCard(deps, input, cardId, workspace, prepared, trackWithEnvironment, resolvedPreset.preset, resolvedPreset.pinnedId, thread);
    return finishCard(deps, input, cardId, workspace, prepared, trackWithEnvironment, resolvedPreset.preset, resolvedPreset.pinnedId, thread, timestamp);
  };
}

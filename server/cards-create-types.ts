import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { CardPromptRules } from "./cards-create-prompt.js";
import type { CardPresetOverride } from "./preset-contracts.js";

export type CardCreateInput = {
  projectId: string;
  environment?: unknown;
  prompt: string;
  attachments: Array<{ path: string; type: "localFile" | "localImage" }>;
  intent: string;
  quality?: string;
  explorationCount?: number;
  explorationHybrid?: boolean;
  redFirst?: string;
  appetite?: string;
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

export type Db = ReturnType<BbPluginApi["storage"]["database"]>;
export type SpawnArgs = Parameters<BbPluginApi["sdk"]["threads"]["spawn"]>[0];
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
export type PresetParams = {
  providerId: string;
  modelId: string;
  reasoningLevel: string;
  permissionMode: string;
  environmentKind: string;
  machineId: string | null;
  instructions: string;
};
export type Seed = {
  error: string | null;
  dirHash: string | null;
  stateDir: string | null;
};
export type Workspace = { projectId: string; rootPath: string; source: { path: string; hostId: string }; exploratory: boolean };
export type ResolvedTrack = {
  research: boolean;
  explore: boolean;
  researchStrategy: ReturnType<typeof import("../lib/research-strategies.mjs").researchStrategyById>;
  exploreStage: ReturnType<typeof import("../lib/technique-catalog.mjs").techniqueById>;
  intent: string;
  reviewGates: string[];
  reviewRung: string;
  seed: Seed;
};
export type ExploreStage = ReturnType<typeof import("../lib/technique-catalog.mjs").techniqueById>;
export type Prepared = {
  displayName: string;
  params: PresetParams;
  environment: unknown;
  roundFile: string;
  prompt: string;
};

export type CardsCreateDeps = {
  db: Db;
  bb: BbPluginApi;
  now: () => number;
  randomId: (prefix: string) => string;
  roundTimestamp: () => string;
  seedBuildIntent: (prompt: string, projectId: string | null) => Promise<string>;
  seedWorkflow: (
    bb: BbPluginApi,
    rootPath: string,
    cardId: string,
    slug: string,
    intent: string,
    knobs: { quality: string; explorationCount: number; explorationHybrid: boolean },
    reviewGates: string[],
  ) => Promise<Seed>;
  researchStrategy: (id: string) => ReturnType<typeof import("../lib/research-strategies.mjs").researchStrategyById>;
  exploreStage: (id: string) => ExploreStage;
  researchIds: () => string[];
  exploreIds: () => string[];
  defaultPreset: () => Preset;
  getPreset: (id: string) => Preset | null;
  getBandPresetId: (band: string) => string | null;
  getReliablePresetId: () => string | null;
  createCardOverride: (cardId: string, base: Preset, override: CardPresetOverride) => Preset;
  pinCardPreset: (cardId: string, presetId: string, assignedAt?: number) => boolean;
  removeCardPreset: (cardId: string) => void;
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

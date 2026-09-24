import type { BbPluginApi } from "@get-bb/plugin-sdk";

export type PresetDb = ReturnType<BbPluginApi["storage"]["database"]>;

export type PresetRow = {
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
  is_default: number;
  built_in: number;
  created_at: number;
  updated_at: number;
};

export type PresetAttachmentParams = {
  providerId: string;
  modelId: string;
  reasoningLevel: string;
  permissionMode: string;
  environmentKind: string;
  baseBranch: string | null;
  machineId: string | null;
  instructions: string;
};

export type PresetCard = {
  id: string;
  kind: string;
  stage: string;
  status: string;
  worker_thread_id: string | null;
  worker_preset_id: string | null;
};

export type CardPresetOverride = {
  providerId: string | null;
  modelId: string | null;
  reasoningLevel: string | null;
  permissionMode: string | null;
};

export type SingletonPresetTable =
  | "review_preset"
  | "generation_preset"
  | "reliable_preset";

export type PresetServerDeps = {
  db: PresetDb;
  bb: BbPluginApi;
  now: () => number;
  errors: { cardNotFound: string; presetNotFound: string };
  getCard: (cardId: string) => PresetCard | undefined;
};

export type PresetUpsertInput = {
  id?: string | null;
  name: string;
  providerId: string;
  modelId: string;
  reasoningLevel: string;
  permissionMode: "accept-edits" | "auto" | "full";
  environmentKind: "project-default" | "new-worktree";
  baseBranch?: string | null;
  machineId?: string | null;
  instructions: string;
};

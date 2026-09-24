export type PresetManagerPreset = {
  id: string;
  name: string;
  providerId: string;
  modelId: string;
  reasoningLevel: string;
  permissionMode: string;
  environmentKind: string;
  builtIn: boolean;
  isDefault: boolean;
};

export type PresetManagerForm = {
  id: string | null;
  name: string;
  providerId: string;
  modelId: string;
  reasoningLevel: string;
  permissionMode: "accept-edits" | "auto" | "full";
  environmentKind: "project-default" | "new-worktree";
};

export type BandPresetEntry = {
  band: string;
  presetId: string | null;
  stages: string[];
};

export const EMPTY_PRESET_FORM: PresetManagerForm = {
  id: null,
  name: "",
  providerId: "",
  modelId: "",
  reasoningLevel: "medium",
  permissionMode: "full",
  environmentKind: "project-default",
};

export function formFromPreset(preset: PresetManagerPreset): PresetManagerForm {
  return {
    id: preset.id,
    name: preset.name,
    providerId: preset.providerId,
    modelId: preset.modelId,
    reasoningLevel: preset.reasoningLevel,
    permissionMode:
      preset.permissionMode as PresetManagerForm["permissionMode"],
    environmentKind:
      preset.environmentKind as PresetManagerForm["environmentKind"],
  };
}

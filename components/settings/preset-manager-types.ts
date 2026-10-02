import { DEFAULT_ENVIRONMENT_KIND } from "./preset-environment-kind.mjs";

export type PresetManagerPreset = {
  id: string;
  name: string;
  providerId: string;
  modelId: string;
  reasoningLevel: string;
  /**
   * The host roster's verdict on that level for that provider. `null` means the
   * host did not say (roster unreadable, or a provider with no declared
   * ladder), which is not the same as supported — see `listPresets`.
   */
  reasoningLevelSupported: boolean | null;
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
  /**
   * A plain string, not the two-option union: an installed row's kind can
   * genuinely hold a value outside the schema, and the form has to be able to
   * carry it so `PresetEnvironmentKindField` can name it rather than hide it.
   * The two options are `ENVIRONMENT_KINDS`; the save path refuses anything
   * else with a reader-facing sentence.
   */
  environmentKind: string;
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
  environmentKind: DEFAULT_ENVIRONMENT_KIND,
};

/**
 * The form carries the preset's stored kind verbatim.
 *
 * An installed row's kind can genuinely hold a value outside the schema's two
 * options — upgraded installs add the column with `ALTER TABLE` and no CHECK,
 * and the CLI casts its flag blindly. A form that normalised it would hide the
 * very fact the person needs to see, so the value travels as it is and
 * `isKnownEnvironmentKind` decides what the control says about it.
 */
export function formFromPreset(preset: PresetManagerPreset): PresetManagerForm {
  return {
    id: preset.id,
    name: preset.name,
    providerId: preset.providerId,
    modelId: preset.modelId,
    reasoningLevel: preset.reasoningLevel,
    permissionMode:
      preset.permissionMode as PresetManagerForm["permissionMode"],
    environmentKind: preset.environmentKind ?? DEFAULT_ENVIRONMENT_KIND,
  };
}

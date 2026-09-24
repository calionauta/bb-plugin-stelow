export type PresetSelection =
  | { kind: "default" }
  | { kind: "custom" }
  | { kind: "preset"; presetId: string }
  | { kind: "model"; providerId: string; modelId: string };

export function classifyPresetSelection(
  selected: string | null,
): PresetSelection | null;

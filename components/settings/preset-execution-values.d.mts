export const PRESET_REASONING_LEVELS: readonly [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "none",
  "ultra",
  "ultracode",
];
export type PresetReasoningLevel = (typeof PRESET_REASONING_LEVELS)[number];
export function asPresetReasoningLevel(value: string): PresetReasoningLevel;
export function modeLabel(mode: string): string;

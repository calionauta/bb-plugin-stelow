export declare const PRESET_REASONING_LEVELS: readonly [
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
export declare const DEFAULT_PRESET_REASONING_LEVEL: PresetReasoningLevel;
export declare function isPresetReasoningLevel(value: unknown): boolean;
export declare function asPresetReasoningLevel(value: unknown): PresetReasoningLevel;
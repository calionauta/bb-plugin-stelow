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

/** One entry of the host provider roster, in the fields this module reads. */
export type ProviderRosterEntry = {
  id: string;
  reasoningLevels?: readonly { id: string; label: string }[] | null;
};
export declare function declaredProviderLevels(
  roster: readonly ProviderRosterEntry[] | null | undefined,
  providerId: string,
): string[] | null;
export declare function isLevelDeclaredForProvider(
  roster: readonly ProviderRosterEntry[] | null | undefined,
  providerId: string,
  level: string,
): boolean | null;
export declare function ladderIncludes(
  declared: readonly string[],
  level: string,
): boolean;
export declare function unsupportedLevelMessage(
  providerId: string,
  level: string,
  declared: readonly string[],
): string;

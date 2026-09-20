export declare const RELIABLE_SOURCE_CARD: string;
export declare const RELIABLE_SOURCE_OVERRIDE: string;
export declare const RELIABLE_SOURCE_BAND: string;
export declare const RELIABLE_SOURCE_DEFAULT: string;

export interface ReliablePresetResolution {
  presetId: string | null;
  source: string | null;
}

export declare function resolveReliablePreset(options: {
  cardPin?: string | null;
  reliableOverride?: string | null;
  bandPreset?: string | null;
  defaultPreset?: string | null;
}): ReliablePresetResolution;

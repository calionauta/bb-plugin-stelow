export declare const COMPOSER_PERMISSION_MODES: Array<"accept-edits" | "auto" | "full">;
export declare const COMPOSER_SERVICE_TIERS: Array<"default" | "fast">;
export declare type ComposerExecution = {
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
};
export declare type ComposerPresetBase = {
  providerId?: unknown;
  modelId?: unknown;
  reasoningLevel?: unknown;
  permissionMode?: unknown;
  provider_id?: unknown;
  model_id?: unknown;
  reasoning_level?: unknown;
  permission_mode?: unknown;
};
export declare type ComposerMergedPreset = {
  providerId: string | null;
  modelId: string | null;
  reasoningLevel: string | null;
  permissionMode: string | null;
};
export declare type ComposerSpawnInput = {
  providerId: string | null;
  model: string | null;
  reasoningLevel: string | null;
  permissionMode: string | null;
  serviceTier?: "default" | "fast";
  executionInputSources: {
    providerId: "explicit" | "client-preference";
    model: "explicit" | "client-preference";
    reasoningLevel: "explicit" | "client-preference";
    permissionMode: "explicit" | "client-preference";
    serviceTier?: "explicit" | "client-preference";
  };
};
export declare function sanitizeComposerExecution(execution: unknown): ComposerExecution | null;
export declare function resolveComposerSpawn(base: ComposerPresetBase, execution: unknown): ComposerMergedPreset;
export declare function composerPresetOverride(base: ComposerPresetBase, execution: unknown): ComposerMergedPreset | null;
export declare function composerSpawnInput(baseParams: ComposerPresetBase, execution: unknown): ComposerSpawnInput;

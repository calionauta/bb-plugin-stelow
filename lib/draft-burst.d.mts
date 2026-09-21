export declare const TIER_RELIABLE: string;
export declare const TIER_GENERATION: string;
export declare const DRAFT_SOURCE_CARD: string;
export declare const DRAFT_SOURCE_BOARD: string;
export declare const DRAFT_SOURCE_BAND: string;
export declare const DRAFT_MAX_CHARS: number;
export declare const CARD_NAME_MAX_CHARS: number;

export interface DraftPresetResolution {
  presetId: string | null;
  source: string | null;
}

export declare function resolveDraftPreset(options: {
  cardPin?: string | null;
  boardDefault?: string | null;
  bandFallback?: string | null;
}): DraftPresetResolution;

export declare function buildDraftPrompt(options: { cardName: string; brief?: string | null }): string;

export interface DraftValidation {
  ok: boolean;
  text: string;
  error?: string;
  truncated?: boolean;
}

export declare function validateDraftOutput(output: unknown): DraftValidation;

export interface CardNameValidation {
  ok: boolean;
  name: string | null;
  error?: string;
  truncated?: boolean;
}

export declare function buildCardNamePrompt(options: { prompt?: string | null; kind?: string | null }): string;

export declare function validateCardName(output: unknown): CardNameValidation;

export declare function heuristicDisplayName(prompt: unknown, fallback: string): string;

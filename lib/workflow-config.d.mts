/** @deprecated Alias only. New code uses the knob defaults above. */
export declare const DEFAULT_APPETITE: string;
export declare const DEFAULT_REVIEW_MODE: string;
export declare const LEGACY_APPETITE_MAP: Record<string, { quality: string; explorationCount: number; explorationHybrid: boolean }>;
export declare function explorationCountToLegacyAlias(count: number): string;
export declare function resolveKnobInput(input: unknown): { quality: string; explorationCount: number; explorationHybrid: boolean; redFirst: string | undefined };
export declare function parseWorkflowConfig(blob: unknown, opts?: { strict?: false }): { quality: string; explorationCount: number; explorationHybrid: boolean; appetite: string; reviewMode: string; reviewGates: string[]; redFirst?: string | null };
export declare function parseWorkflowConfig(blob: unknown, opts: { strict: true }): { quality: string | null; explorationCount: number | null; explorationHybrid: boolean | null; appetite: string | null; reviewMode: string | null; reviewGates: string[] | null; redFirst?: string | null };
export declare function withoutUndefined<T>(value: T): T;

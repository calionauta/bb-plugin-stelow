/**
 * Pure start-policy gate for GitHub automation: decides from the effective
 * spawn environment (band routing wins over passed presets at spawn time).
 */
export declare function decideAutomationSpawn(options: {
  startImmediate?: unknown;
  effectiveEnvKind?: unknown;
}): { start: boolean; parkedReason: string | null };
export declare function resolveEffectiveEnvKind(options: {
  bandEnvKind?: unknown;
  worktreePresetId?: unknown;
}): string;
export declare function describeParkedReason(reason: unknown): string;

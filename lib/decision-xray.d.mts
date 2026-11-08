export declare function summarizeDecisions(
  receipts: Array<Record<string, unknown>>,
  current: { shapeVersion?: unknown },
): {
  live: number;
  stale: number;
  unknown: number;
  conflicts: Array<{ a: string; b: string; scopeIds: string[] }>;
} | null;
export declare function formatDecisionNote(summary: {
  live?: unknown;
  stale?: unknown;
  unknown?: unknown;
  conflicts?: unknown;
} | null): string;

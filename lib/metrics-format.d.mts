/** The gap tally every surface reports. Declared once: adding a resolution to
 * the registry is a field added here, not a type restated in five call sites. */
export interface GapTotals {
  total: number;
  fixed: number;
  documented: number;
  escalated: number;
}

export declare function emptyGapTotals(): GapTotals;

/** Folds a parsed `summarizeGaps` result in. A summary with `found:false` is a
 * document with no parseable registry and contributes nothing. */
export declare function addGapTotals<T extends GapTotals>(target: T, summary: { found: boolean } | null | undefined): T;

/** The escalated share, or null when there were no findings. */
export declare function escalationRate(totals: Partial<GapTotals> | null | undefined): number | null;

/** `"n/a"` for an absent rate, so two surfaces cannot disagree about whether a
 * rate is a measurement. */
export declare function formatRate(rate: number | null | undefined): string;

export declare function formatGapTotals(totals: Partial<GapTotals> | null | undefined): string;

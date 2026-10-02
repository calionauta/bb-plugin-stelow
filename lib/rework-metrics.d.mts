export type ReworkResolution = string;

/** One critique round's findings, as the registry reports them. */
export type RoundGaps = Array<{ description: string; resolution: string }>;

export interface ReworkSummary {
  /** Critique rounds found, oldest first. */
  rounds: number;
  /** Passes after the first — the denominator. Zero means "not measurable". */
  comparable: number;
  /** Findings closed in one round and re-opened in a strictly later one. */
  reworked: number;
  /** Findings first seen in a later round: new work, deliberately not rework. */
  newAfterFirst: number;
  /** Null until a second round exists: one pass cannot show convergence. */
  rate: number | null;
  /** Named so a rate can be traced back to the finding that caused it. */
  reworkedDescriptions: string[];
}

export declare function summarizeRework(rounds: RoundGaps[] | null | undefined): ReworkSummary;

/** The rework line, or "" when there is nothing to say. */
export declare function reworkMetricLine(summary: unknown): string;

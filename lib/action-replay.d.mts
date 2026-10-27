type Source = string;

export interface ReplayEntry {
  at: number;
  summary: string;
  ref?: string | null;
}

export interface ReplayRow extends ReplayEntry {
  source: Source;
}

export declare function replayTimeline(
  sources: Record<string, ReplayEntry[] | undefined>,
  options?: { since?: number | null; limit?: number | null },
): ReplayRow[];

export declare function formatActionTime(at: number): string;
export declare function formatActionRows(rows: Array<Record<string, any>>): string;
export declare function summarizeDetail(detail: unknown, limit?: number): string;
export declare function formatActionDuration(row: Record<string, any>): string;

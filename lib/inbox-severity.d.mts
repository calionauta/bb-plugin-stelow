export declare const SEVERITY_ROUTINE: number;
export declare const SEVERITY_ACTION: number;
export declare const SEVERITY_ESCALATING: number;
export declare const SEVERITY_STALL_MS: number;
export declare const SEVERITY_OLD_MS: number;
export declare const SEVERITY_ERROR_REPETITIONS: number;

export declare function stalledDays(ms: number): number;

export interface SeverityScore {
  severity: number;
  reasons: string[];
}

export declare function scoreEventSeverity(options: {
  kind?: string | null;
  ageMs?: number | null;
  stallCount?: number | null;
  errorRepetitions?: number | null;
}): SeverityScore;

export declare function parseSeverityReasons(value: unknown): string[];

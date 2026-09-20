export declare const GOLDEN_KEEP_KAPPA: number;
export declare const GOLDEN_DROP_KAPPA: number;
export declare const GOLDEN_MIN_N: number;

export interface GoldenFile {
  ok: boolean;
  name?: string;
  skill?: string;
  judgments?: Record<string, string>;
  artifact?: string;
  reason?: string;
}

export declare function parseGoldenFile(text: unknown): GoldenFile;

export interface KappaReport {
  n: number;
  agreement: number | null;
  kappa: number | null;
}

export declare function cohenKappa(pairs: unknown): KappaReport;

export declare function goldenVerdict(report: unknown): "keep" | "repair" | "drop";

// Type declarations for lib/research-rounds.mjs

export interface StrategyRound {
  id: string;
  /** ISO timestamp, or null for legacy history without timestamps. */
  at: string | null;
}

export declare const ROUNDS_DIR: string;
export declare function slugify(text: unknown): string;
export declare function roundTimestamp(date?: Date): string;
export declare function roundFilePath(strategyId: string, roundNo: number, stamp: string, subskill?: string | null): string;
export declare function normalizeHistory(raw: unknown, fallbackId?: unknown): StrategyRound[];
export declare function matchRoundFile(relPath: unknown, strategyId: string, roundNo: number): boolean;
export interface RoundFile {
  display: string;
  path: string;
  absolutePath: string;
  hostId: string;
  generatedAt: string;
}

export interface RoundView {
  n: number;
  strategyId: string;
  at: string | null;
  status: "ready" | "pending" | "missing";
  files: RoundFile[];
}

export declare function buildRoundsView(
  history: StrategyRound[],
  files: RoundFile[],
  live: boolean,
): RoundView[];

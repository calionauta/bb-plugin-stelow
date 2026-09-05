// Type declarations for lib/research-rounds.mjs

export interface StrategyRound {
  id: string;
  at: string;
  file: string;
}

export interface ParsedRoundPath {
  /** Sub-step slug, or null for the round's primary file. */
  subskill: string | null;
  roundNo: number;
  stamp: string;
}

export declare const ROUNDS_DIR: string;
export declare function slugify(text: unknown): string;
export declare function roundTimestamp(date?: Date): string;
export declare function roundFileName(strategyId: string, roundNo: number, stamp: string, subskill?: string | null): string;
export declare function parseRoundPath(relPath: unknown, strategyId: string): ParsedRoundPath | null;
export declare function normalizeHistory(raw: unknown): StrategyRound[];

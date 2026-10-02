export type ExcerptMode = "whole" | "contract" | "head";
export declare function excerptFact(
  record: unknown,
): { selected: ExcerptMode; truncated: boolean; sentChars: number | null; originalChars: number | null } | null;
export declare function summarizeExcerpts(records: unknown): {
  counted: number;
  truncated: number;
  headCuts: number;
  byMode: Record<ExcerptMode, number>;
  meaning: Record<ExcerptMode, string>;
};
export declare function excerptMetricLine(summary: unknown): string;
export declare const EXCERPT_MODES: readonly ExcerptMode[];

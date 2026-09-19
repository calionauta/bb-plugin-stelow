export interface GapEntry {
  index: number;
  type: string | null;
  area: string | null;
  description: string | null;
  impact: string | null;
  resolution: string | null;
}

export interface GapSummary {
  found: boolean;
  total: number;
  fixed: number;
  documented: number;
  escalated: number;
}

export interface GapFailure {
  code: string;
  expected: string;
  found: string;
  detail: string;
}

export function frontmatterBlock(text: unknown): string | null;

export function parseGapFrontmatter(text: unknown): { found: boolean; gaps: GapEntry[] };

export function escalatedGaps(text: unknown): GapEntry[];

export function summarizeGaps(text: unknown): GapSummary;

export function validateGapRegistry(text: unknown): GapFailure[];

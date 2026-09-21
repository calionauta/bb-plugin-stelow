export interface GapEntry {
  index: number;
  type: string | null;
  area: string | null;
  description: string | null;
  impact: string | null;
  effort: string | null;
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

export interface GapTriageItem {
  id: string;
  name: string;
  text: string;
}

export function gapsToTriageBatch(
  gaps?: Array<{ id?: string; description?: string } | null> | null,
): {
  items: GapTriageItem[];
  questions: Record<string, { type: string; instructions: string; criteria: string[] }>;
};

export declare const GAP_TRIAGE_CRITIQUE_CHARS: number;

export function buildGapTriageState(options?: {
  critiqueText?: string | null;
  diff?: string | null;
}): string;

export interface GapEvidence {
  symbols: string[];
  files: string[];
  callers: number | null;
  tests: string[];
  reversible: string | null;
  check: string | null;
}

export interface GapEntry {
  index: number;
  type: string | null;
  area: string | null;
  description: string | null;
  impact: string | null;
  effort: string | null;
  resolution: string | null;
  /** Present only when the row carries an `evidence:` block. */
  evidence?: GapEvidence | null;
  /** Present only when that block does not parse. */
  evidenceError?: string | null;
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

export function registryGaps(text: unknown): Array<{ description: string; resolution: string }>;

export function summarizeGaps(text: unknown): GapSummary;

export function validateGapRegistry(text: unknown): GapFailure[];

export function normalizeGapEvidence(raw: unknown): { evidence: GapEvidence | null; error: string | null };

export function hasGapEvidence(evidence: unknown): boolean;

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

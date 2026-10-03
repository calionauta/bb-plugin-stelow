import type { GapEvidence } from "./gap-evidence.mjs";

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
  /** Debt metadata scalars ride the row when present; validated separately. */
  expires?: string | null;
  owner?: string | null;
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

export function gapResolution(value: unknown): string;


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

export interface GapRow {
  description: string;
  /** `fixed` | `documented` | `escalate`, normalised. */
  resolution: string;
  /** The area the finding names, or null when the row carries none. */
  area: string | null;
}

export function registryGaps(text: unknown): GapRow[];

export interface GapTally {
  total: number;
  fixed: number;
  documented: number;
  escalated: number;
}

/** Tally a finding list: the count every surface prints is this one. */
export function tallyGaps(rows: Array<{ resolution?: string | null }> | unknown): GapTally;

export function summarizeGaps(text: unknown): GapSummary;

export function validateGapRegistry(text: unknown): GapFailure[];

export function gapResolution(value: unknown): string;


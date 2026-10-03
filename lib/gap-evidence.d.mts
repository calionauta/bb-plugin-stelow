export interface GapEvidence {
  symbols: string[];
  files: string[];
  callers: number | null;
  tests: string[];
  reversible: string | null;
  check: string | null;
}

export declare function stripQuotes(value: unknown): string;

export declare function normalizeGapEvidence(raw: unknown): { evidence: GapEvidence | null; error: string | null };

export declare function hasGapEvidence(evidence: unknown): boolean;

export declare function validateGapEvidence(
  gap: { evidenceError?: string | null },
  label: string,
): { code: string; expected: string; found: string; detail: string } | null;

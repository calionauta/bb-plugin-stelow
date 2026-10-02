// Type declarations for lib/review-verdict.mjs

export declare const MAX_REVIEW_CHARS: number;
export declare const REVIEW_VERDICTS: string[];

export interface ReviewFinding {
  criterion: string;
  quote: string;
  verdict: "PASS" | "FAIL";
  repair: string;
}

export interface ParsedReview {
  status: string;
  findings: ReviewFinding[];
  dropped: number;
  raw: boolean;
}

/** What the reviewer received, and how it was chosen. `selected` is
 * `whole` | `contract` | `head` — a review of the contract's sections and a
 * review of the document's opening are different reviews, so callers record it. */
export interface ReviewExcerpt {
  text: string;
  truncated: boolean;
  originalChars: number;
  sentChars: number;
  selected: "whole" | "contract" | "head";
  headings?: string[];
}

export declare function buildReviewPrompt(input: {
  cardName: string;
  request: string;
  contractLabel: string;
  artifactContent: unknown;
  deterministicFailures?: string[];
  evidence?: string;
  contract?: unknown;
}): { prompt: string; excerpt: ReviewExcerpt };
export declare function extractJsonBlock(output: unknown): unknown;
export declare function parseReviewOutput(output: unknown, artifactContent: unknown): ParsedReview;
export declare function reviewSummary(parsed: ParsedReview): string;
export declare function reviewCoversFingerprint(reviewFiles: Array<{ name: string; content: unknown }>, fingerprint: string | null): boolean;
export declare function reviewExcerptRecords(reviewFiles: Array<{ name: string; content: unknown }>): Array<{
  excerpt: { selected: string; sentChars: number; originalChars: number; truncated: boolean };
}>;

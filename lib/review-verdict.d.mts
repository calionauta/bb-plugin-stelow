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

export declare function buildReviewPrompt(input: {
  cardName: string;
  request: string;
  contractLabel: string;
  artifactContent: unknown;
  deterministicFailures?: string[];
  evidence?: string;
}): string;
export declare function extractJsonBlock(output: unknown): unknown;
export declare function parseReviewOutput(output: unknown, artifactContent: unknown): ParsedReview;
export declare function reviewSummary(parsed: ParsedReview): string;
export declare function reviewCoversFingerprint(reviewFiles: Array<{ name: string; content: unknown }>, fingerprint: string | null): boolean;

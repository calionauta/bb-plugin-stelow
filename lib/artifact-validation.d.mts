// Type declarations for lib/artifact-validation.mjs

export interface ValidationFailure {
  code: string;
  expected: string;
  found: string;
  detail: string;
}

export declare function wordCount(text: unknown): number;
export declare function tableRowCount(text: unknown): number;
export declare function sectionItemCount(text: unknown, heading: string): number;
export declare function fieldBlockCount(text: unknown, marker: string, fields: string[]): number;
export declare function validateArtifact(text: unknown, contract: { minWords?: number; checks?: Array<{ kind: string; [key: string]: unknown }> } | null): { pass: boolean; failures: ValidationFailure[] };
export declare function validateSubstep(slug: string, content: unknown): { pass: boolean; failures: ValidationFailure[] };
export declare function validateExplore(stageId: string, content: unknown): { pass: boolean; failures: ValidationFailure[] };
export declare function sealStatus(valid: { pass: boolean } | null, evidence: string): "verified" | "hypothesis-only" | "needs-revision" | "unverified";
export declare function buildDocDepths(stateBlob: unknown, readContent: (path: string) => string | null): Array<{ path: string; label: string; failures: string[] }>;
export declare function validateVariant(text: unknown, contract: { variants?: Array<{ minWords?: number; checks?: Array<{ kind: string; [key: string]: unknown }> }> } | null): { pass: boolean; failures: ValidationFailure[] };

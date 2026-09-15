export declare const SPLIT_KEEP_LABEL: string;
export declare const MAX_SPLIT_CHILDREN: number;
export declare const MIN_SPLIT_CHILDREN: number;
export declare const SPLIT_PROPOSAL_TTL_MS: number;
export declare const SPLIT_STAGES: string[];
export declare const SPLIT_NON_BUILD_ERROR: string;
export declare type SplitSlice = { title?: string; label?: string; desc?: string; description?: string };
export declare function validateSplitSlices(slices: unknown): string | null;
export declare function splitOutcome(
  slices: unknown,
  selected: unknown,
): { action: "keep" | "split" | "refuse"; approved: SplitSlice[]; reason: string };
export declare function splitRemainder(
  slices: unknown,
  approved: unknown,
): { approved: SplitSlice[]; remaining: SplitSlice[]; archiveParent: boolean };
export declare function splitStageError(stage: unknown): string;
export declare function splitEligibility(input: { kind: unknown; stage: unknown }): { ok: boolean; error: string | null };
export declare function splitActionState(input: {
  kind: unknown;
  stage: unknown;
  status: unknown;
  archived: unknown;
  openProposal: unknown;
  openQuestions: unknown;
}): { show: boolean; ok: boolean; reason: string | null };
export declare function matchSplitDecision(
  proposalQuestion: unknown,
  decisions: unknown,
): string[];
export declare const STANDARD_SPLIT_DISCLOSURE: string;
export declare function withStandardSplitDisclosure(question: unknown): string;
export declare function recordSplitAnswer(
  db: { prepare: (sql: string) => { get: (...params: any[]) => any; run: (...params: any[]) => any } },
  cardId: string,
  decisions: unknown,
): number;

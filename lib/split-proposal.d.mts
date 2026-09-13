export declare const SPLIT_KEEP_LABEL: string;
export declare const MAX_SPLIT_CHILDREN: number;
export declare const MIN_SPLIT_CHILDREN: number;
export declare const SPLIT_PROPOSAL_TTL_MS: number;
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

export type BulkEligibility = {
  ok: boolean;
  reason: string | null;
};

export declare function canBulkStart(card: unknown): BulkEligibility;
export declare function canBulkArchive(card: unknown): BulkEligibility;
export declare function canBulkDelete(card: unknown): BulkEligibility;

// Generic over the caller's card shape: eligibility never inspects more than
// it returns, so the partition keeps the input type instead of widening it
// to unknown and forcing every consumer to cast it back.
export declare function partitionByEligibility<T>(
  cards: T[],
  predicate: (card: T) => BulkEligibility,
): {
  eligible: T[];
  skipped: Array<{ card: T; reason: string | null }>;
};

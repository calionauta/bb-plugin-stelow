export function canBulkStart(card: unknown): {
  ok: boolean;
  reason: string | null;
};
export function canBulkArchive(card: unknown): {
  ok: boolean;
  reason: string | null;
};
export function canBulkDelete(card: unknown): {
  ok: boolean;
  reason: string | null;
};
export function partitionByEligibility(
  cards: unknown[],
  predicate: (card: unknown) => { ok: boolean; reason: string | null },
): {
  eligible: unknown[];
  skipped: Array<{ card: unknown; reason: string | null }>;
};

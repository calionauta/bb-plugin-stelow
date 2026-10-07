export declare const DECISION_READS_CAP: number;
export declare function receiptsForScopes(
  receipts: Array<{ id: string; scopeIds?: unknown; kind?: unknown }>,
  scopes: string[],
): Array<Record<string, unknown>>;
export declare function capReads(
  selected: Array<Record<string, unknown>>,
  cap?: number,
): { served: Array<Record<string, unknown>>; omittedIds: string[] };
export declare function formatDecisionReads(served: Array<Record<string, unknown>>, omittedIds: string[]): string;

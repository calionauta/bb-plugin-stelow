export declare const DECISION_RECEIPTS_FILE: string;
export declare const DECISION_RECEIPT_SCHEMA_VERSION: number;
export declare function buildDecisionReceipt(
  input: {
    selectedId?: unknown;
    rejectedOptionIds?: unknown;
    scopeIds?: unknown;
    reason?: unknown;
    supersedes?: unknown;
    challengeId?: unknown;
    approvedBy?: unknown;
    approvedAt?: unknown;
  },
  minted: { id: string; shapeVersion?: string },
): { ok: true; receipt: Record<string, unknown> } | { ok: false; reason: string };
export declare function validateDecisionReceipt(receipt: unknown): string[];
export declare function parseReceipt(value: unknown): Record<string, unknown> | null;
export declare function parseReceiptFile(text: unknown): Array<Record<string, unknown>>;
export declare function parseReceiptStore(text: unknown): {
  receipts: Array<Record<string, unknown>>;
  challenges: Array<Record<string, unknown>>;
  corrupt: boolean;
};
export declare function buildChallenge(
  input: { receiptId?: unknown; reason?: unknown; openedBy?: unknown; openedAt?: unknown },
  minted: { id: string },
): { ok: true; challenge: Record<string, unknown> } | { ok: false; reason: string };
export declare function parseChallenge(value: unknown): Record<string, unknown> | null;
export declare function serializeReceiptFile(
  receipts: Array<Record<string, unknown>>,
  challenges?: Array<Record<string, unknown>>,
): string;

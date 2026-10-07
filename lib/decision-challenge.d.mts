export declare function isChallengeable(
  receipt: { id?: unknown; supersededBy?: unknown },
  current: { shapeVersion?: unknown; scopeMapVersion?: unknown },
): boolean;
export declare function requiresChallenge(
  proposal: { scopeIds?: unknown; optionIds?: unknown; selectedId?: unknown },
  liveReceipts: Array<Record<string, unknown>>,
  challenges: { challengeReceiptIds?: unknown },
): { receiptId: string; reason: string } | null;

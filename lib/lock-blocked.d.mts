export type LockBlock = {
  cardId: string;
  file: string;
  holderCardId: string;
  holderName: string;
  expiresAt: number;
};

export declare function lockBlockSummary(block: LockBlock): string;
export declare function lockBlockDedupeKey(block: Pick<LockBlock, "cardId" | "file">): string;
export declare function lockBlockEvent(block: LockBlock): {
  summary: string;
  dedupeKey: string;
  holderCardId: string;
  holderFile: string;
};

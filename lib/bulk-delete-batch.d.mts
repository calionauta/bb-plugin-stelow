export declare const BULK_DELETE_BATCH_SIZE: number;

export declare function deleteInBatches(
  deleteBatch: (batch: string[]) => Promise<unknown>,
  cardIds: string[],
): Promise<{ deleted: string[]; failed: { cardId: string; error: string }[] }>;

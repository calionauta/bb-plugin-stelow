export function runInBatches(action: (batch: string[]) => Promise<unknown>, cardIds: readonly string[]): Promise<{ succeeded: string[]; failed: Array<{ cardId: string; error: string }> }>;

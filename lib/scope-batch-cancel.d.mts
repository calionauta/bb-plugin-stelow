type Db = {
  exec(query: string): void;
  prepare(query: string): {
    run(...values: unknown[]): unknown;
    get(...values: unknown[]): any;
    all(...values: unknown[]): any[];
  };
  transaction(fn: (...args: any[]) => any): (...args: any[]) => any;
};
export declare function ensureScopeBatchCancelTables(db: Db): void;
export declare function cancelBatch(db: Db, args: {
  batchId: string;
  cardId?: string | null;
  cardIds?: string[];
  scopes?: Array<string | { scopeId?: string; id?: string; cardId?: string }>;
  reason?: string;
  nowMs?: number;
}): {
  duplicate: boolean;
  batchId: string;
  cardId: string;
  runsCancelled?: number;
  cancelledScopes: number;
  inFlightScopes?: string[];
  releasedClaims: Array<{ workspacePath: string; file: string; scope?: string | null }> | number;
  clearedWaiters: number;
  notified: Array<{ cardId: string; scope: string | null; workspacePath: string; file: string; visibility: string }>;
};

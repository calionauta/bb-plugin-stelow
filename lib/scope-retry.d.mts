type Db = {
  exec(query: string): void;
  prepare(query: string): {
    run(...values: unknown[]): unknown;
    get(...values: unknown[]): any;
    all(...values: unknown[]): any[];
  };
  transaction(fn: (...args: any[]) => any): (...args: any[]) => any;
};
export declare function ensureScopeRetryTables(db: Db): void;
export declare function claimScopeRetry<T>(db: Db, args: {
  batchId: string;
  scopeId: string;
  retryKey: string;
  run: () => T;
  revalidate?: (() => boolean | { ok: boolean; reason?: string }) | null;
  nowMs?: number;
}): { duplicate: boolean; outcome: T; failed?: boolean; code?: string };

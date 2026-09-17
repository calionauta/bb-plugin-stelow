type RunResult = { changes: number };
type Db = {
  prepare(query: string): {
    run(...values: unknown[]): RunResult;
    get(...values: unknown[]): any;
  };
};
export declare const MAX_SPAWN_RETRIES: number;
export declare function spawnRetryDelayMs(attempt: number, rand?: () => number): number;
export declare function isRetryableSpawnError(message: unknown): boolean;
export declare function claimSpawnRetry(db: Db, cardId: string, threadId: string, maxRetries?: number): number;
export declare function resetSpawnRetry(db: Db, cardId: string): void;

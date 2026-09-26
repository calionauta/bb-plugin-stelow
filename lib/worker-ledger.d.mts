type RunResult = { changes: number };
type Db = {
  prepare(query: string): {
    run(...values: unknown[]): RunResult;
    get(...values: unknown[]): any;
  };
};
export declare function recordWorkerThread(db: Db, cardId: string, threadId: string, presetId: string | null, endedReason: string): number;
export declare function stallCount(db: Db, cardId: string): number;
export declare function refreshRestartPending(db: Db, cardId: string, workerThreadId: string | null, workerPresetId: string | null, effectivePresetId: string): number;
export declare function assignedPreset(db: Db, cardId: string): { preset_id: string; assigned_at: number } | undefined;
export declare function healPresetStaleness(db: Db, cardId: string, threadBorn: unknown, flagSet: unknown): boolean;

type RunResult = { changes: number };
type Db = {
  prepare(query: string): {
    run(...values: unknown[]): RunResult;
    get(...values: unknown[]): any;
  };
  transaction(fn: (...args: unknown[]) => unknown): (...args: unknown[]) => unknown;
};
export declare function normalizeQuestionText(text: unknown): string;
export declare function validateAskContracts(
  declarations: Array<{ contractId?: unknown } | null> | null | undefined,
  checklist: Array<{ id?: unknown; kind?: unknown } | null> | null | undefined,
): { ok: boolean; error: string | null };
export declare function recordAskContracts(
  db: Db,
  rows: Array<{ id?: unknown; cardId?: unknown; question?: unknown; contractId?: unknown; askedAt?: unknown } | null> | null | undefined,
): number;
export declare function consumeAskContract(db: Db, cardId: string, questionText: unknown, consumedAt?: number): string | null;

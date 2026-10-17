export type QuestionContract = {
  stage: string;
  id: string;
  kind: "human-ask" | "agent-receipt" | "skip";
  modes: string[];
  /** @deprecated Use exploration_min_count. Kept for old catalogs. */
  appetite?: string[];
  exploration_min_count?: number;
  evidence?: string;
  receipt: string;
};

export function requiredForStage(input?: { stage?: string; reviewMode?: string | string[]; appetite?: string; explorationCount?: number; kind?: QuestionContract["kind"] }): Array<Pick<QuestionContract, "id" | "kind" | "receipt">>;

/* merged from lib/ask-contracts.d.mts */
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

export declare function reactivateRestorePending(db: { prepare(query: string): { run(...values: unknown[]): { changes: number } } }, input: {
  cardId: string;
  lastError?: string | null;
  occurredAt: number;
}): { questionsReopened: number; errorsReopened: number; pausedReopened: number; completedReopened: number };

export declare function reactivateRestorePending(db: { prepare(query: string): { run(...values: unknown[]): { changes: number }; get(...values: unknown[]): { held: number } | undefined } }, input: {
  cardId: string;
  lastError?: string | null;
  occurredAt: number;
}): {
  /** Always 0: a question belongs to the worker that asked it, and restore
   * starts a fresh one. See the module docstring for the full argument. */
  questionsReopened: number;
  /** Archived questions left closed, so the caller can name them and the exit. */
  questionsWithheld: number;
  errorsReopened: number;
  pausedReopened: number;
  completedReopened: number;
};

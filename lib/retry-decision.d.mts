export type RetryRefusal =
  | "not-retryable: nothing was proved to have been skipped"
  | "card-gone"
  | "card-archived"
  | "card-moved-on: the card advanced past the failed stage, so re-running its recipe would overwrite newer work"
  | "retry-budget-spent: one automatic attempt per chain is the limit"
  | "launch-refused"
  | "launch-reported-no-run";

export const RETRY_REFUSALS: readonly RetryRefusal[];

export interface RetryDecisionInput {
  errorCode: string | null | undefined;
  autoRetryCount: number | null | undefined;
  cardStage: string | null | undefined;
  runStage: string | null | undefined;
  cardExists: boolean;
  cardArchived: boolean;
}

export interface RetryDecision {
  retry: boolean;
  /** Whether this refusal is worth a trail line. False when the caller already
   * recorded the same fact, so the record is not written twice. */
  recordable: boolean;
  reason: string | null;
  exit: string | null;
}

export function retryDecision(input: RetryDecisionInput): RetryDecision;

export function refusalRecord(input: {
  reason: string | null;
  exit: string | null;
  recipeId: string;
  runId: string;
  recordable?: boolean;
}): string | null;

export function refusalNeedsAttention(reason: string | null): boolean;

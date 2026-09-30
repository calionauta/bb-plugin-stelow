/** The three fields the refusal quotes. The gate never needs the whole run. */
export type BlockingRun = {
  id: string;
  recipeId: string;
  errorCode: string | null;
};

/**
 * The failed run holding this card at this stage, or null.
 *
 * Scoped to the stage: a card accumulates runs for every stage it has passed,
 * and gating on the card's newest run would block a card that failed three
 * stages ago and has moved on cleanly since. "Newest" breaks `created_at` ties
 * by insertion order, so a retry launched in the same tick is never mistaken for
 * the run it retries.
 */
export declare function blockingFailedRun(
  db: unknown,
  cardId: string,
  stage: string,
): BlockingRun | null;

/** The refusal, always naming the door that releases the hold. */
export declare function failedRunRefusal(run: BlockingRun): string;

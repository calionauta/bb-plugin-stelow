/** The activity a card shows: idle, running, awaiting-answer, error, or held. */
export type CardActivity = "idle" | "running" | "awaiting-answer" | "error" | "held";

/**
 * The activity to show, given the stored column and how many questions are
 * actually open (`null` when the question source could not be read).
 *
 * A successful read of zero ENDS an `awaiting-answer`; an unreadable source
 * keeps the last verified projection; a live question re-asserts the wait.
 * `error` and `held` describe the worker and outrank the question count.
 */
export declare function effectiveActivity(
  storedActivity: unknown,
  openQuestions: number | null | undefined,
): CardActivity;

/** The badge the card's attention state derives from, using the same two inputs. */
export declare function attentionFromQuestions(
  storedActivity: unknown,
  openQuestions: number | null | undefined,
): "question" | null;

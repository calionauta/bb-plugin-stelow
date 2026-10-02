/** Which publication actions this card's kind and intent can justify. */
export declare function publishActionsFor(
  kind: string,
  intent: string,
): Set<string>;

/** Whether this card produces work that belongs in the repository. */
export declare function cardPublishesCode(kind: string, intent: string): boolean;

/**
 * One sentence for a card whose deliverable is not code, saying why the
 * delivery buttons are absent. Null when the card publishes code.
 */
export declare function publishRelevanceNote(
  kind: string,
  intent: string,
): string | null;

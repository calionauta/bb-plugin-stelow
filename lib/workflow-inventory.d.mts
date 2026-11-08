/** The card id a workflow entry belongs to, or null when it has no card. */
export declare function cardIdOfWorkflow(workflow: unknown): string | null;

/** The entries a board may show: live cards, plus everything cardless. */
export declare function visibleWorkflows<T>(
  workflows: readonly T[] | unknown,
  cardExists: (cardId: string) => unknown,
): T[];

/** The entries whose card row is gone: prune candidates, never cardless ones. */
export declare function orphanWorkflows<T>(
  workflows: readonly T[] | unknown,
  cardExists: (cardId: string) => unknown,
): T[];

/** The tracking document with orphans removed, or null when there is nothing to do. */
export declare function withoutOrphans(
  tracking: unknown,
  cardExists: (cardId: string) => unknown,
): { workflows: unknown[] } | null;

/** The directory-hash prefix that marks a card-owned workflow entry. */
export declare const CARD_WORKFLOW_PREFIX: string;

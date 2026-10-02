export type IntegrationPendingState = "unpublished" | "local" | "unmerged";

export interface IntegrationPending {
  /** Which rung of the ladder the card is stuck on. */
  state: IntegrationPendingState;
  /** Short noun for the board chip. */
  label: string;
  /** One sentence naming what is missing and what the user can do. */
  detail: string;
}

export interface IntegrationPendingCard {
  id: string;
  status: string;
  workspace_kind?: string | null;
}

/**
 * What a finished card still owes its repository, or null when nothing is
 * owed. Reads the publication ledger only — never a live `git` call.
 */
export declare function integrationPending(
  db: { prepare: (sql: string) => { all: (cardId: string) => Array<{ action: unknown }> } },
  card: IntegrationPendingCard,
): IntegrationPending | null;

/** The chip label for a card, or null when nothing is pending. */
export declare function integrationPendingLabel(
  card: IntegrationPendingCard,
  integration: IntegrationPending | null,
): string | null;

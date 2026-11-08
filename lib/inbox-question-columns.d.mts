/** Adds the question columns to a live `inbox_events` table; idempotent. */
export declare function ensureInboxQuestionColumns(
  db: { prepare(query: string): { all(): Array<{ name: string }> } },
): void;

/** Resolve rows whose key fell out of the open set, and reopen those that returned. */
export declare function resolveAndReopen(
  db: { prepare(query: string): { run(...values: unknown[]): { changes: number } } },
  input: { cardId: string; keys: string[]; occurredAt: number },
): { unresolved: number; reopened: number };

/** Mint one row per open key; `INSERT OR IGNORE` makes a re-poll idempotent. */
export declare function insertQuestionRows(
  db: { prepare(query: string): { run(...values: unknown[]): { changes: number } } },
  input: {
    keys: string[];
    cardId: string;
    summary: string;
    occurredAt: number;
    createId: () => string;
    questionSummary: string | null;
    questionCount: number | null;
    questionKind: "split" | null;
    insert: (db: unknown, event: unknown) => boolean;
  },
): number;

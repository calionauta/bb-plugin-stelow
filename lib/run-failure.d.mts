/** A raw failed run: the ledger's own fact, before any wording is chosen. */
export interface RunFailureRecord {
  /** The run's `error_code` exactly as written. May be null or blank. */
  errorCode: string | null;
}

/** What the board tile carries: the chip's label and its one-line reason. */
export interface RunFailure {
  /** Always `RUN_FAILURE_LABEL`. */
  label: string;
  /** The reason, mapped then truncated; never empty, never an instruction. */
  detail: string;
}

/** The subset of the worker card row this derivation needs. The RAW row, not the projected card. */
export interface RunFailureCardRow {
  id: string;
  status: string;
}

type RunFailureDb = {
  prepare: (sql: string) => {
    get: (cardId: string) => { normalized_status: string; error_code: string | null } | undefined;
  };
};

/**
 * The card's NEWEST execution run, read as a failure or null.
 *
 * Newest means `ORDER BY created_at DESC, rowid DESC LIMIT 1`; `rowid DESC` is
 * mandatory because `listExecutionRuns` orders by `created_at DESC` alone and
 * SQLite promises no order for a same-millisecond tie. Fail-soft: a read that
 * throws returns null so one unreadable card cannot blank the board.
 */
export declare function lastRunFailure(db: RunFailureDb, cardId: string): RunFailureRecord | null;

/**
 * The board signal for one card, or null.
 *
 * Terminal cards (`completed | archived | blocked`) derive nothing. Terminality is
 * judged on the RAW row via `isClaimTerminal`, never on the projected
 * `readCardStatus(card.status)`, where `blocked` can never appear.
 */
export declare function runFailure(db: RunFailureDb, row: RunFailureCardRow): RunFailure | null;

/**
 * The one sentence the tile may carry. A null or blank code yields
 * `NO_RUN_REASON`; this plugin's own literals are translated; everything else,
 * including free-form host text, passes through unchanged. Truncated after
 * mapping.
 */
export declare function runFailureDetail(errorCode: string | null | undefined): string;

/** The chip label, fixed. One word distinguishes this from the worker's own failure. */
export declare const RUN_FAILURE_LABEL: string;

/** Stated words for a failure recorded without a reason. Never an empty title. */
export declare const NO_RUN_REASON: string;

/** This plugin's own error codes, in a reader's words. Unmapped and host codes pass through. */
export declare const RUN_FAILURE_REASON_LABELS: Readonly<Record<string, string>>;

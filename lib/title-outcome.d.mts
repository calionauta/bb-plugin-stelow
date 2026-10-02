/**
 * Type declarations for lib/title-outcome.mjs.
 *
 * Required because tsconfig.json sets no `allowJs` — every lib module imported
 * from TypeScript ships a hand-written sibling declaration.
 */

/** The complete closed set of title-burst outcomes. */
export type TitleOutcome =
  | "delivered"
  | "delivered_after_retry"
  | "card_gone"
  | "spawn_failed"
  | "thread_error"
  | "timed_out"
  | "no_output"
  | "invalid_output"
  | "renamed_mid_burst"
  | "archived_mid_burst"
  | "internal_error";

export declare const TITLE_OUTCOMES: readonly TitleOutcome[];

/** The shape `waitForThread` resolves to, as the title path sees it. */
export type TitleCompletion = {
  status: string;
  timedOut: boolean;
};

/** The subset of a card the classifier needs. */
export type TitleCardSnapshot = {
  title: string;
} | null;

export type ClassifyInput = {
  spawned?: boolean;
  completion?: TitleCompletion | null;
  output?: string;
  validated?: { ok: boolean; name: string | null } | null;
  live?: TitleCardSnapshot;
  originalTitle?: string | null;
  archived?: boolean;
  threw?: boolean;
};

export type CommentContext = {
  presetName?: string;
  presetSource?: string | null;
  retried?: boolean;
};

export declare function isRecordable(outcome: string): boolean;
export declare function classifyTitleOutcome(input?: ClassifyInput): TitleOutcome;
export declare function titleOutcomeComment(outcome: string, context?: CommentContext): string | null;
export declare function isRetryable(outcome: string): boolean;

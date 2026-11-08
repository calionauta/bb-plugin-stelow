/** The five statuses a card can hold. Derived by who writes them, not by word. */
export type CardStatus = "draft" | "pending" | "in-progress" | "completed" | "archived";

export declare const CARD_STATUSES: ReadonlyArray<CardStatus>;

export declare const CARD_STATUS_LABELS: Readonly<Record<CardStatus, string>>;

/** The name for a card status; the raw value when it is not one of the five. */
export declare function cardStatusLabel(status: unknown): string;

/** Whether a value is one of the five statuses a card may hold. */
export declare function isKnownCardStatus(status: unknown): boolean;

/**
 * Read a card's status, defaulting an unknown one to `draft`.
 *
 * The read-side counterpart to `assertCardStatus`, and deliberately NOT the
 * scope normalizer: card status was being read through a pendency's vocabulary,
 * which only worked while that vocabulary was an inaccurate superset.
 */
export declare function readCardStatus(status: unknown): CardStatus;

/**
 * Refuse an unknown card status, naming the value and the five that exist.
 *
 * No-ops on `undefined` and `null`: most card writes do not touch the status.
 */
export declare function assertCardStatus(status: unknown, where: string): void;

/** Whether the card is past answering: completed or archived. */
export declare function isTerminalCardStatus(status: unknown): boolean;

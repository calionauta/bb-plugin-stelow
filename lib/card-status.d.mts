/** The four statuses a card can hold. Derived by classification, not observation. */
export type CardStatus = "draft" | "pending" | "in-progress" | "completed" | "archived";

export declare const CARD_STATUSES: ReadonlyArray<CardStatus>;

export declare const CARD_STATUS_LABELS: Readonly<Record<CardStatus, string>>;

/** The name for a card status; the raw value when it is not one of the four. */
export declare function cardStatusLabel(status: unknown): string;

/** Whether a value is one of the four statuses a card may hold. */
export declare function isKnownCardStatus(status: unknown): boolean;

/**
 * Refuse an unknown card status, naming the value and the four that exist.
 *
 * No-ops on `undefined` and `null`: most card writes do not touch the status.
 */
export declare function assertCardStatus(status: unknown, where: string): void;

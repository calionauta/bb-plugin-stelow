/**
 * A failure need is identified by its card. These are the pieces that make
 * that true, kept apart from the general event row so the difference between
 * "an event happened" and "a need recurred" stays readable.
 */
import type { InboxEventInput } from "./inbox-events.mjs";

/**
 * The identity of a failure need, identified by the card.
 *
 * The key used to end with the card's `updated_at`, which made it unique by
 * construction: a key containing the moment of the very event it exists to
 * collapse can never collide, so the UNIQUE index never fired and every failure
 * episode appended a row. Two identical failures eleven minutes apart became two
 * items in the reader's inbox, each claiming to be a separate thing.
 *
 * Identity here is the need, not the moment — the same shape the question key
 * uses, where the interaction is the identity and repeated syncs are idempotent.
 */
export declare function errorInboxDedupeKey(cardId: string): string;

export declare function ensureInboxOccurrencesColumn(db: unknown): void;

export type ErrorInboxOutcome = "bumped" | "inserted" | "reopened" | "ignored";

/**
 * Record a failure need, collapsing a repeat onto what is already open.
 *
 * `outcome` reports which of the three cases happened, which is what the tests
 * assert on — "collapse" and "swallow" are one keystroke apart, and swallowing
 * a new failure is worse than duplicating an old one.
 */
export declare function recordErrorInboxEvent(
  db: unknown,
  event: Omit<InboxEventInput, "dedupeKey" | "occurrences">,
): { id: string | null; outcome: ErrorInboxOutcome; occurrences: number };

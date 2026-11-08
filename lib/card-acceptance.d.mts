/** Human acceptance of a finished card (lib/card-acceptance.mjs). */

/** Why this card cannot be accepted, or null when it can. */
export declare function acceptanceRefusal(input?: {
  status?: string | null;
  archived?: boolean;
}): string | null;

/** Whether a card carries an acceptance receipt. */
export declare function isAccepted(acceptedAt?: number | null): boolean;

/** The disposition line a reader sees, or null when there is no receipt. */
export declare function acceptanceLine(acceptedAt?: number | null): string | null;

/** The date half of the line, as a plain calendar date in UTC. */
export declare function acceptedDate(acceptedAt?: number | null): string;

/** The number of the card's still-open pull request, or null. */
export declare function unmergedPrNumber(publication?: {
  pullRequest?: { number?: unknown; state?: unknown } | null;
} | null): number | null;

export declare const READ_STREAK_WARN_AT: number;
export type HostReadStreak = {
  /** Record a missed read and return the streak it brings the card to. */
  unreadable(cardId: string): number;
  /** A read came back; the outage, if any, is over. */
  readable(cardId: string): void;
  /** The card left the sync's scope; drop its streak. */
  forget(cardId: string): void;
  streakOf(cardId: string): number;
};
export declare function createHostReadStreak(warn: (cardId: string, streak: number) => void): HostReadStreak;
export declare const READ_MISS_COLUMN: "read_miss_since";
/** Latches the warning on the card the first time the streak reaches the threshold. */
export declare function readMissUpdates(
  streak: number,
  alreadySince: number | null,
  at: number,
): Record<string, unknown>;
/** Clears the warning when a read answers, or when the card leaves scope. */
export declare function readRecoveredUpdates(alreadySince: number | null): Record<string, unknown>;
/** The card's sentence, derived from the measurement. Null when nothing is wrong. */
export declare function readMissSummary(since: number | null, nowMs: number): string | null;
/** The hero reading for an unreadable card, or null when the host is answering. */
export declare function readMissHero(
  since: number | null,
  nowMs: number,
  stageName: string,
): { kind: "unreadable"; title: string; sub: string } | null;

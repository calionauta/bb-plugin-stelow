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
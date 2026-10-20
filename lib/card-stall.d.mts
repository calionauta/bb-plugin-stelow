/** The paused half of the recovery vocabulary, owned in one place. */
export function cardIsStalled(card: {
  activity: string;
  needsAttention?: boolean | null;
}): boolean;

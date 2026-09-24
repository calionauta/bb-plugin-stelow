export type CardAttentionState = {
  status: string;
  activity: string;
  needsAttention: boolean;
  workerThreadId: string | null;
};

export function cardIsTerminal(card: CardAttentionState): boolean;
export function cardCanResume(card: CardAttentionState): boolean;
export function cardShowsAttention(card: CardAttentionState): boolean;
export function cardNeedsReview(card: { status: string; hasPendingReview: boolean }): boolean;

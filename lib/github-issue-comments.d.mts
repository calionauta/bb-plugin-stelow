export function commentFingerprint(input: { author: string; createdAt: string; body: string }): string;
export function toMirrorRows(cardId: string, comments: Array<{ author: string; createdAt: string; body: string }>, fetchedAt: number): Array<{ id: string; card_id: string; author: string; body: string; created_at: number; fetched_at: number }>;

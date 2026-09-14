/**
 * The durable definition of an answerable question. A proposal row or a
 * worker's chat message is merely intent; it never blocks progress by itself.
 * Only a live interaction or a persisted recovery question is visible to the
 * person who can answer it.
 *
 * @param {{ liveInteractions: number, expiredQuestions: number }} counts
 * @returns {{ canOpen: boolean, reason: string | null }}
 */
export function questionOpenGuard({ liveInteractions, expiredQuestions }) {
  if (liveInteractions > 0) {
    return {
      canOpen: false,
      reason: "A structured question is already pending on this card. Wait for its card answer instead of asking again.",
    };
  }
  if (expiredQuestions > 0) {
    return {
      canOpen: false,
      reason: "An earlier question is still answerable on this card. Wait for its card answer instead of asking again.",
    };
  }
  return { canOpen: true, reason: null };
}

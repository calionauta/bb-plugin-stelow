/**
 * Verifiable completion write-back: never trust the send — match a hidden
 * marker back on the remote issue. A run that posted nothing is not
 * success, and idempotent retries must never double-post.
 */

export function markerFor(cardId) {
  return `<!-- stelow:card=${cardId} -->`;
}

export function carriesMarker(comments, marker) {
  if (typeof marker !== "string" || !marker) return false;
  if (!Array.isArray(comments)) return false;
  return comments.some((comment) => typeof comment?.body === "string" && comment.body.includes(marker));
}

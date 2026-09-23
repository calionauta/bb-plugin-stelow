/**
 * Read-only mirror of GitHub issue comments into the card.
 *
 * A separate stream from the card conversation by design: mirrored rows must
 * never render as You/Agent chatter nor route to the worker — external text
 * is context, never instructions. The github plugin type carries no comment
 * ids, so identity is a fingerprint over author+createdAt+body, and storage
 * dedupes on it (INSERT OR IGNORE). Edits and deletes upstream are NOT
 * tracked: the mirror is an append-only snapshot, documented as such.
 */
import { createHash } from "node:crypto";

export function commentFingerprint({ author, createdAt, body }) {
  return createHash("sha256").update(`${author ?? ""}\n${createdAt ?? ""}\n${body ?? ""}`, "utf8").digest("hex");
}

export function toMirrorRows(cardId, comments, fetchedAt) {
  return (Array.isArray(comments) ? comments : []).map((comment) => {
    const createdAt = Date.parse(comment?.createdAt);
    return {
      id: commentFingerprint({ author: comment?.author, createdAt: comment?.createdAt, body: comment?.body }),
      card_id: cardId,
      author: String(comment?.author ?? ""),
      body: String(comment?.body ?? ""),
      created_at: Number.isFinite(createdAt) ? createdAt : fetchedAt,
      fetched_at: fetchedAt,
    };
  });
}

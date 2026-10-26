/**
 * The comment store's half of "a comment rides the answer".
 *
 * Three questions, asked from two places: is an answer still expected (so a
 * comment should wait)? which comments are waiting? and did they actually go
 * (so they can be marked carried)?
 *
 * The third is separate on purpose. Marking on read would stamp a comment as
 * carried by an answer whose send then failed, so the worker would never see it
 * and nothing would say so — the same shape of lie `thread-send` exists to stop.
 * Read, send, then mark, and only when the dispatch was `sent`.
 */
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { answerFeedbackBlock } from "../../lib/answer-feedback.mjs";

type Db = ReturnType<BbPluginApi["storage"]["database"]>;

/** Open recovery questions: an answer is still expected, so a comment waits. */
export function openExpiredCount(db: Db, cardId: string): number {
  const row = db
    .prepare("SELECT COUNT(*) AS n FROM expired_questions WHERE card_id = ? AND answered = 0")
    .get(cardId) as { n?: number } | undefined;
  return typeof row?.n === "number" ? row.n : 0;
}

export type PendingAnswerComments = {
  /** The block for the resume prompt. Null when nothing usable waits. */
  block: string | null;
  /** The rows the block was built from, for the mark that follows a sent dispatch. */
  ids: string[];
};

/**
 * The user's comments no answer has carried yet, newest last.
 *
 * Only `author = 'user'`: the agent's own trail comments are the card's record,
 * and feeding them back to the worker would make it answer itself.
 */
export function pendingAnswerComments(db: Db, cardId: string): PendingAnswerComments {
  const rows = db.prepare(
    "SELECT id, body FROM comments WHERE card_id = ? AND author = 'user' "
    + "AND delivered_at IS NULL ORDER BY created_at ASC",
  ).all(cardId) as Array<{ id?: string; body?: string }>;
  const usable = rows.filter((row) => typeof row.id === "string" && typeof row.body === "string");
  return {
    block: answerFeedbackBlock(usable.map((row) => row.body!)),
    ids: usable.map((row) => row.id!),
  };
}

/** Mark the comments a sent answer carried, so none of them rides twice. */
export function markCommentsCarried(db: Db, ids: readonly string[], at: number): void {
  if (ids.length === 0) return;
  const stamp = db.prepare("UPDATE comments SET delivered_at = ? WHERE id = ? AND delivered_at IS NULL");
  for (const id of ids) stamp.run(at, id);
}

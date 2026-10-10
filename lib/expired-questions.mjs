import { cleanOptions } from "./question-batch.mjs";
import { isTerminalCardStatus } from "./card-status.mjs";

/**
 * Open recovery rows for the card.
 *
 * Moved out of the card-detail server module untouched: the detail file
 * sits exactly at its size budget, and this read is a self-contained seam
 * (database rows in, question shapes out) with injected collaborators, so
 * it is exercised against real I/O like every other lib reader.
 *
 * A finished card's open questions closed with it, so serving them as
 * answerable forms is a phantom affordance — submitting wakes nothing the
 * card can still use. The answered ones stay readable through the trail
 * comments, which is where a person looks for what was decided.
 */
export async function readOpenExpiredQuestions({ db, resolveAskOptions }, card) {
  if (isTerminalCardStatus(card.status)) return [];
  const rows = db
    .prepare("SELECT * FROM expired_questions WHERE card_id = ? AND answered = 0 ORDER BY expired_at DESC")
    .all(card.id);
  const questions = [];
  for (const row of rows) {
    let parsed = null;
    try {
      parsed = JSON.parse(String(row.options));
    } catch {
      parsed = null;
    }
    questions.push({
      id: String(row.id),
      question: String(row.question),
      multiple: Boolean(row.multiple),
      kind: row.kind === "split" ? "split" : "standard",
      options: await resolveAskOptions(card, cleanOptions(parsed)),
      expiredAt: Number(row.expired_at),
    });
  }
  return questions;
}

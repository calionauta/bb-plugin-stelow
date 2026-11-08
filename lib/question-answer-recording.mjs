/**
 * Answer recording: the one rule both answer doors use to leave a trail.
 *
 * Extracted from the runtime door so the rule is a `lib/` behaviour with its own
 * test, and so the door stops being four hundred lines of plumbing. The module
 * owns no host dependency: the database, the consume and the comment writer all
 * arrive as collaborators, which is what lets the trail be exercised against a
 * real SQLite store in a plain node test.
 *
 * Two facts are recorded for every answered question, and they are different
 * halves of the same entry:
 *
 * - the DECISION, with the contract it satisfies (or none), so a grep for a
 *   satisfied contract cannot miss it;
 * - the GROUND, when it is gone. An answer whose premise the rewind removed is
 *   still a human decision — it is not deleted, and it is not called wrong — but
 *   it no longer rests on the cell or artifact it was asked about, it claims no
 *   contract, and the trail says which premise is missing. A stale decision that
 *   silently reads as current is the defect this sentence exists to prevent.
 */

import { staleTrailLine } from "./premise-staleness.mjs";
import { answerCommentBody } from "./question-evidence.mjs";

/**
 * Record every answered question on the card's trail, and name each stale
 * premise once.
 *
 * `consume(db, cardId, question, { observe })` is the store's answer boundary
 * (lib/question-contracts): it returns the contract and the premise verdict, and
 * it leaves the declaration unconsumed when the premise is gone. `observe` may be
 * null — then there is no verdict and every existing answer behaves exactly as
 * it did before premises existed.
 *
 * `knownStaleNotes` carries verdicts already computed inside a transaction (the
 * recovery door commits before it records), so a note is never recomputed
 * against a store that has already moved.
 */
export function recordAnswerTrail({
  db,
  cardId,
  decisions,
  observe = null,
  consume,
  logComment,
  knownStaleNotes = [],
}) {
  if (typeof consume !== "function") throw new Error("recordAnswerTrail: consume is required.");
  if (typeof logComment !== "function") throw new Error("recordAnswerTrail: logComment is required.");
  const staleNotes = [...knownStaleNotes];
  const entries = (Array.isArray(decisions) ? decisions : []).map((decision) => {
    if (!decision?.question) return { ...decision, contract: null };
    const answered = consume(db, cardId, decision.question, { observe });
    const note = staleTrailLine(answered?.verdict);
    if (note) staleNotes.push(note);
    return { ...decision, contract: answered?.contract ?? null };
  });
  const body = [answerCommentBody(entries), ...staleNotes].filter(Boolean).join("\n\n");
  if (body) logComment(cardId, "card", cardId, "user", body);
  return { entries, body };
}

/**
 * Connect recovery-row answers to their questions, and mark the rows answered.
 *
 * One transaction, because the contract is consumed inside it on purpose: a
 * half-written batch must not be able to claim a contract it never satisfied.
 * The stale notes come back to the caller instead of being written here — the
 * trail comment waits until the rows are committed, since a comment about an
 * answer that rolled back is a lie on the card.
 */
export function commitRecoveryAnswers({ db, cardId, rows, observe = null, consume }) {
  if (typeof consume !== "function") throw new Error("commitRecoveryAnswers: consume is required.");
  const decisions = [];
  const staleNotes = [];
  db.transaction(() => {
    for (const row of Array.isArray(rows) ? rows : []) {
      const answered = consume(db, cardId, row.question, { observe });
      const note = staleTrailLine(answered?.verdict);
      if (note) staleNotes.push(note);
      decisions.push({
        question: row.question,
        answers: Array.isArray(row.answers) ? row.answers : [],
        contract: answered?.contract ?? null,
      });
      db.prepare("UPDATE expired_questions SET answered = 1 WHERE id = ?").run(row.id);
    }
  })();
  return { decisions, staleNotes };
}

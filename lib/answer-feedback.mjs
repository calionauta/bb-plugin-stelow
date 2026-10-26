// Comments written while the card waits on an answer.
//
// The rule: a comment typed during a review belongs to the decision, not beside
// it. Sent on its own it wakes the worker mid-read, so the person's picks land
// as a second turn and the first turn acts on half a thought. Plannotator keeps
// the same rule ("annotations ride your next Send") and this module is the
// plugin's half of it: the hold decision and the block the worker reads, in one
// place, because both the comment path and the answer path have to agree about
// what "still waiting" means.
//
// The comment is never withheld from the card: it is written to `comments` as
// always, and the mark is only about whether the WORKER has been sent it yet
// (`delivered_at`). A held comment survives a crash, an answer that never comes,
// and a card archived by mistake.

import { holdSentence } from "./host-hold.mjs";

/** The heading the resume prompt gives the comments, so a worker can find them. */
export const ANSWER_FEEDBACK_HEADER = "Feedback written while answering";

/**
 * Whether a comment should ride the next answer instead of waking the worker.
 *
 * Two things mean an answer is still expected: the card's activity says it is
 * waiting on the person (`awaiting-answer`, set by `questionWaitUpdates`), or
 * recovery rows are still open — a timed-out ask is answered later, and the
 * comment written during it belongs to that answer all the same.
 *
 * @param {{ activity?: string | null, openExpired?: number | null }} facts
 */
export function answerFeedbackHolds(facts) {
  const { activity, openExpired } = facts ?? {};
  if (activity === "awaiting-answer") return true;
  return typeof openExpired === "number" && openExpired > 0;
}

/**
 * The block appended to the answer's continuation. Null when nothing waits.
 *
 * The bodies are passed through verbatim: the card's own comment composer
 * already formats them (`Re <file>: #### Excerpt N`, the quote, the note), and
 * re-formatting here would be a second author of the same words.
 *
 * @param {readonly string[] | null | undefined} bodies
 */
export function answerFeedbackBlock(bodies) {
  const comments = (Array.isArray(bodies) ? bodies : [])
    .filter((body) => typeof body === "string" && body.trim().length > 0)
    .map((body) => body.trim());
  if (comments.length === 0) return null;
  const lines = [
    `## ${ANSWER_FEEDBACK_HEADER}`,
    "",
    "These came with the answers above. They are part of the decision: read them "
    + "before acting on the answers, and do not treat them as a separate request "
    + "to answer first.",
    "",
  ];
  comments.forEach((body, index) => {
    lines.push(`### Comment ${index + 1}`, "", body, "");
  });
  return lines.join("\n").trimEnd();
}

/**
 * What the comment composer tells the reader after a save.
 *
 * The happy path returns null and the caller keeps its own "sent to the agent"
 * toast; every other outcome needs a line, because a comment that did not reach
 * the worker while the composer said it did is the same lie the answer door used
 * to tell.
 *
 * @param {"sent" | "queued" | "rides-answer" | null} delivery
 * @param {unknown} hold
 */
export function commentDeliveryLine(delivery, hold) {
  if (delivery === "rides-answer") {
    return "Comment saved. It goes with your answer to this question — the worker is not woken twice.";
  }
  if (delivery === "queued") {
    return "Comment saved. "
      + (holdSentence(hold) ?? "The host is holding it. The card continues on its own — no action needed.");
  }
  return null;
}

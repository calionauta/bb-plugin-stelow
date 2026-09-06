/**
 * Question-wait state. Single rule for BOTH tracks (research + delivery):
 * a pending question is activity ("awaiting-answer"), never board position.
 * Board position (status / stage) is durable progress; parking on a question
 * must not move the card. Research regressed Doing -> To-Do because a
 * "awaiting-answer" status normalized to "pending" ("never started").
 *
 * Writers use questionWaitUpdates (activity only). Readers heal legacy rows
 * via healQuestionStatus / researchColumnForStatus until every stored row
 * predating this rule has been rewritten.
 */

/** Activity value while a structured question waits for an answer. */
export const QUESTION_ACTIVITY = "awaiting-answer";

/** True for stored statuses that leak the wait activity into board position. */
export function isQuestionStatus(status) {
  return status === QUESTION_ACTIVITY;
}

/**
 * Heal a stored status for display. A legacy "awaiting-answer" row means
 * work visibly began — the worker ran far enough to ask — so it heals to
 * "in-progress", never "pending" (which would read as "never started").
 */
export function healQuestionStatus(status) {
  return isQuestionStatus(status) ? "in-progress" : status;
}

/**
 * Update fields for "a question is now pending". Carries activity only —
 * never `status`, so the card stays in its column on both tracks. Pin this
 * shape in one place so a future `status` key cannot sneak back in.
 */
export function questionWaitUpdates(lastOutput) {
  return { activity: QUESTION_ACTIVITY, last_assistant_text: lastOutput };
}

/**
 * Update fields for "an ask call ended, the worker resumes". Activity only —
 * the ask layer never owns board position either: forcing `in-progress` here
 * once dragged draft Triage cards to Running on their very first question,
 * and pushed To-Do research cards to Doing on a mere timeout. Status moves
 * belong to the sync poll (triage guard, work began), the explicit answer
 * RPCs, and advance/moveCard — never to the question transport.
 */
export function askFinishedUpdates() {
  return { activity: "running" };
}

/**
 * Research board column for a stored status. Heals the legacy leak first,
 * so an old "awaiting-answer" row reads as Doing, never To-Do.
 */
export function researchColumnForStatus(status) {
  const healed = healQuestionStatus(status);
  if (healed === "archived") return "archived";
  if (healed === "completed") return "done";
  if (healed === "in-progress" || healed === "approved") return "doing";
  return "todo";
}

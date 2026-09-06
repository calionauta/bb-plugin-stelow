/**
 * Question-wait state. Single rule for BOTH tracks (research + delivery):
 * a pending question is activity ("awaiting-answer"), never board position.
 * Board position (status / stage) is durable progress; parking on a question
 * must not move the card.
 *
 * Writers use questionWaitUpdates (activity only). Stored statuses are used
 * as-is: no value produced anywhere needs healing.
 */

/** Activity value while a structured question waits for an answer. */
export const QUESTION_ACTIVITY = "awaiting-answer";

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
 * Research board column for a stored status.
 */
export function researchColumnForStatus(status) {
  if (status === "archived") return "archived";
  if (status === "completed") return "done";
  if (status === "in-progress" || status === "approved") return "doing";
  return "todo";
}

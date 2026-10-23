/**
 * Question store: durable question state in one place.
 * Merges card-question-state (wait activity), status-question-state
 * (status line), expired-questions (open recovery rows),
 * expired-question-answers (recovery payload), question-staleness
 * (artifact/checkout verdicts), question-sync-kick (early inbox sync).
 * Answer recording and persist-failure live in question-evidence;
 * cancel policy lives in question-gate.
 */
/**
 * Question-wait state. Single rule for ALL tracks (build + research + explore):
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

// Compatibility name for existing UI consumers. The lightweight lifecycle
// belongs to tracks.mjs, alongside its columns and move-status mapping.
export { lightweightColumnForStatus as researchColumnForStatus } from "./tracks.mjs";

/**
 * How `bb stelow status` reports an open question.
 *
 * On card_48uuhus1 a worker asked "is a question already pending?" by firing
 * `--question "ping" --option "a"` at the human, because no read-only verb
 * reported the answer. Refusing that probe tells the worker not to do it and
 * leaves it exactly as stuck: it still cannot see the state it was trying to
 * observe. So the answer has to be readable somewhere, and status is the verb
 * a worker already runs.
 *
 * Pure (no DB, no BB host), so every render shape is exercised in tests.
 *
 * @typedef {{ expired: number, live: number }} QuestionCount
 * @typedef {{ name: string, status: string, stage: string,
 *   questions?: QuestionCount | null }} StatusBoardLine
 */

/**
 * The column a human (or an agent) reads to answer "is anything waiting on
 * me?". Absent counts render nothing, so a board that does not report
 * questions stays exactly as it was.
 *
 * @param {StatusBoardLine} workflow
 * @param {string} [tab]
 * @returns {string}
 */
export function renderStatusLine(workflow, tab = "\t") {
  const base = `${workflow.name}${tab}${workflow.status}${tab}${workflow.stage}`;
  const questions = workflow.questions;
  if (!questions) return base;
  const open = questions.expired + questions.live;
  if (!(open > 0)) return base;
  return `${base}${tab}open-questions=${open}`;
}
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

import { isSplitQuestion } from "./question-presentation.mjs";

// Convert a COMPLETE BatchStepper response into the durable timed-out-question
// RPC shape. Timed-out questions are still one blocking decision: sending a
// subset could resume work before the remaining answers change its direction.

export function expiredAnswerPayload(questions, answerGroups) {
  if (!Array.isArray(questions) || !Array.isArray(answerGroups)) return [];
  const payload = questions.map((question, index) => {
    const answers = cleanAnswerList(answerGroups[index]);
    if (typeof question?.id !== "string") return null;
    if (answers.length > 0) return { questionId: question.id, answers };
    // Empty means none on multiple-choice (split proposals excepted): an
    // unchecked checkbox list submits as an explicit none. Single-select
    // stays unanswerable here, so the batch keeps its atomic refusal and
    // the server names the open question instead of guessing.
    if (question.multiple === true && !isSplitQuestion(question)) {
      return { questionId: question.id, answers: [] };
    }
    return null;
  });
  return payload.every((item) => item !== null) ? payload : [];
}

/**
 * Clean one answer list: trim, drop empties and non-strings. Used both when
 * building the recovery payload and when the host re-cleans submitted
 * answers at the RPC boundary — the server never trusts client cleaning.
 */
export function cleanAnswerList(answers) {
  if (!Array.isArray(answers)) return [];
  return answers
    .filter((answer) => typeof answer === "string" && answer.trim())
    .map((answer) => answer.trim());
}

/**
 * Question staleness. A pending (or recoverable expired) question points at
 * documents through its option artifacts; the checkout may also have moved
 * since the ask. This module compares an ask-time snapshot against a fresh
 * observation with no I/O, so the verdict is unit-testable and the wording
 * stays factual: it reports what changed, never whether it matters.
 *
 * Writers snapshot at ask time (see the ask handler); readers observe at
 * cardDetail time. Rows are keyed by (card, artifact path), latest wins —
 * re-asking about a revised document re-baselines it.
 */

/**
 * @param snapshot ask-time baseline, or null when the question predates the
 * ledger (or carried no resolvable artifact): no baseline means no verdict.
 * @param observed fresh read: sha256 hex of the artifact (null when the file
 * can no longer be read), and the checkout HEAD (null when unknown/non-Git).
 */
export function stalenessOf(snapshot, observed) {
  if (!snapshot || typeof snapshot.artifactSha256 !== "string" || !snapshot.artifactSha256) return null;
  const docRemoved = !observed || typeof observed.sha256 !== "string" || !observed.sha256;
  if (docRemoved) return { docRevised: false, docRemoved: true, checkoutMoved: false };
  const docRevised = observed.sha256 !== snapshot.artifactSha256;
  const checkoutMoved =
    typeof snapshot.gitRoot === "string" &&
    !!snapshot.gitRoot &&
    typeof snapshot.headSha === "string" &&
    !!snapshot.headSha &&
    typeof observed.headSha === "string" &&
    !!observed.headSha &&
    observed.headSha !== snapshot.headSha;
  if (!docRevised && !checkoutMoved) return null;
  return { docRevised, docRemoved: false, checkoutMoved };
}

/** True when at least one per-question verdict names a change. */
export function anyStale(verdicts) {
  return Array.isArray(verdicts) && verdicts.some((verdict) => verdict !== null && typeof verdict === "object");
}

import { QUESTION_WAITING_SUMMARY, syncQuestionInboxEvents } from "./inbox-events.mjs";

/**
 * The inbox row for a fresh question, minted early.
 *
 * `bb stelow ask` blocks inside the host's requestInput, so the open path
 * cannot mint synchronously: the pending interaction exists host-side only
 * once that call runs. Without a kick, the row waits for the 45s reconcile
 * tick (or a thread event, or a card open) while the card already shows the
 * question — the Build counter and the Inbox badge both read zero behind a
 * visible wait. This schedules one early sync that observes the interaction
 * a moment after the ask starts; the tick stays the backstop.
 *
 * Fail-safe by construction: an empty observation skips instead of
 * resolving everything open as superseded, a failed interaction read keeps
 * the previous state, and every write underneath is idempotent — a kick
 * that races the tick (or a second kick) mints nothing twice.
 */

/** Delay between the ask call and the early sync: long enough for the host
 * to register the interaction, short enough to feel instant. */
const QUESTION_SYNC_KICK_MS = 1500;

export async function syncFreshQuestionInbox(deps) {
  const { db, bb, pendingAsks, openExpiredQuestionIds, now, randomId, threadId, cardId } = deps;
  try {
    const asks = await pendingAsks(threadId);
    if (!asks) return null;
    const ids = [...asks.map((ask) => ask.id), ...openExpiredQuestionIds(cardId)];
    if (ids.length === 0) return null;
    const result = syncQuestionInboxEvents(db, {
      cardId,
      interactionIds: ids,
      occurredAt: now(),
      createId: () => randomId("evt"),
      summary: QUESTION_WAITING_SUMMARY,
    });
    const changed = result.inserted + result.resolved + result.reopened + result.pausedSuperseded;
    if (changed > 0) bb.realtime.publish("inbox-changed", { cardId });
    return result;
  } catch {
    // A failed read or write keeps the previous state: the reconcile tick
    // is the backstop, and a kick must never crash the host loop.
    return null;
  }
}

/** Returns a cancel function; the timer never holds the loop open. */
export function kickQuestionSync(deps, { threadId, cardId, delayMs = QUESTION_SYNC_KICK_MS } = {}) {
  const timer = setTimeout(() => {
    void syncFreshQuestionInbox({ ...deps, threadId, cardId });
  }, delayMs);
  if (typeof timer.unref === "function") timer.unref();
  return () => clearTimeout(timer);
}

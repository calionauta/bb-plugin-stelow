/**
 * The single-choice rule, resolved against real question shapes.
 *
 * The rule itself lives in lib/question-single-pick.mjs. This module is where
 * the two payload shapes that CARRY a question become the one shape that rule
 * reads: a live interaction's `payload.questions[]`, and a recovery row's stored
 * `options` JSON. Both answering doors use it, so neither can drift from the
 * other on what "the question declared" means.
 *
 * It lives in `lib/` rather than beside the answering doors because it is pure
 * data shaping — no database, no host — and because the doors' module imports
 * `.mjs` siblings, which resolve in every test harness.
 */
import { expandInteractionQuestions, exclusivePickRefusal } from "./question-batch.mjs";

/**
 * @typedef {{ id: string, question: string, multiple: boolean, options: string[] }} QuestionShape
 * @typedef {{ questionId: string, answers: string[] }} Answer
 * @typedef {{ kind: "single", answers: string[] } | { kind: "batch", answers: string[][] }} GroupedAnswer
 * @typedef {{ id: string, question: string, multiple: unknown, options?: unknown }} ExpiredRow
 */

/**
 * The single-choice rule across a whole batch: the first question with two
 * declared picks refuses everything. Atomic submit means answering the rest
 * would resume the worker early, so the refusal is whole — never partial.
 *
 * Free text is not a pick, so "A" plus a note still passes.
 *
 * @param {QuestionShape[]} questions
 * @param {Answer[]} answers
 * @returns {string | null}
 */
export function exclusivePickError(questions, answers) {
  for (const item of answers) {
    const question = (Array.isArray(questions) ? questions : [])
      .find((entry) => entry && entry.id === item?.questionId);
    if (!question) continue;
    const refusal = exclusivePickRefusal({
      question: question.question,
      multiple: question.multiple,
      answers: item.answers,
      optionLabels: question.options,
    });
    if (refusal) return refusal;
  }
  return null;
}

/**
 * The declared shape of every live sub-question, by the id the card submits.
 *
 * A batch interaction addresses its sub-questions as `<id>#<index>`; a single
 * interaction is the bare id. Both spellings land in one map so the guard can
 * look a question up without knowing which kind it came from.
 *
 * @param {Array<{ id: string, payload?: { title?: string } }>} asks
 * @returns {Map<string, Omit<QuestionShape, "id">>}
 */
export function liveQuestionShapes(asks) {
  const shapes = new Map();
  for (const ask of Array.isArray(asks) ? asks : []) {
    if (!ask || typeof ask.id !== "string") continue;
    const expanded = expandInteractionQuestions({
      id: ask.id,
      title: ask.payload?.title,
      payload: ask.payload,
    });
    for (const item of expanded) {
      shapes.set(item.questionId, {
        question: item.question,
        multiple: item.multiple === true,
        options: item.options
          .map((option) => (typeof option?.label === "string" ? option.label : ""))
          .filter((label) => label.length > 0),
      });
    }
  }
  return shapes;
}

/**
 * One shape per sub-question slot, so the guard sees each question alone.
 *
 * @param {string} interactionId
 * @param {GroupedAnswer} value
 * @param {Map<string, Omit<QuestionShape, "id">>} shapes
 * @returns {QuestionShape[]}
 */
export function slotsOf(interactionId, value, shapes) {
  const ids = value.kind === "single"
    ? [interactionId]
    : value.answers.map((_, index) => `${interactionId}#${index}`);
  const out = [];
  for (const id of ids) {
    const shape = shapes.get(id);
    if (shape) out.push({ id, ...shape });
  }
  return out;
}

/**
 * One answer list per sub-question slot, aligned with `slotsOf`.
 *
 * @param {string} interactionId
 * @param {GroupedAnswer} value
 * @returns {Answer[]}
 */
export function answersFor(interactionId, value) {
  if (value.kind === "single") return [{ questionId: interactionId, answers: value.answers }];
  return value.answers.map((slot, index) => ({ questionId: `${interactionId}#${index}`, answers: slot }));
}

/**
 * The declared option labels of a recovery row, read from the stored payload.
 *
 * A row whose options will not parse yields none — the guard then reads every
 * answer as free text and passes, which is the fail-open direction: an
 * unreadable payload must never silence a real answer.
 *
 * @param {ExpiredRow} row
 * @returns {string[]}
 */
function expiredOptionLabels(row) {
  try {
    const parsed = JSON.parse(String(row?.options ?? "[]"));
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((entry) => (typeof entry === "string" ? entry : entry?.label))
      .filter((label) => typeof label === "string" && label.length > 0);
  } catch {
    return [];
  }
}

/**
 * The refusal for a recovery batch, read BEFORE any row is written, from the
 * same helper the live door uses — so no half-answered batch resumes a worker.
 *
 * @param {ExpiredRow[]} openRows
 * @param {Answer[]} answers
 * @returns {string | null}
 */
export function expiredAnswerRefusal(openRows, answers) {
  const shapes = (Array.isArray(openRows) ? openRows : []).map((row) => ({
    id: String(row?.id ?? ""),
    question: String(row?.question ?? ""),
    multiple: Boolean(row?.multiple),
    options: expiredOptionLabels(row),
  }));
  return exclusivePickError(shapes, answers);
}

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
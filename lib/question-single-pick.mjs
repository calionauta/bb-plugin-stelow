/**
 * One choice, enforced.
 *
 * A single-select question renders as a radio group, so at most one declared
 * option may be picked. The renderer clamps the pick, and the server refuses a
 * batch that arrives with several — because a stale bundle, a retried request
 * or a different client can still send two, and the worker would receive them
 * as two separate decisions (issue #383).
 *
 * A pick and a free-text note compose, so the answer list is legitimately
 * longer than one string. What it may never hold is two PICKS. That is why
 * every rule here counts DECLARED LABELS rather than entries: a note matches no
 * label, so it can never trip the guard.
 *
 * Pure and host-free, so the matrix is pinned in
 * `tests/exclusive-pick.test.mjs` without standing up a card.
 */

/**
 * Toggle one pick of a single-select question.
 *
 * Choosing a second label REPLACES the first, and re-picking the current one
 * clears it (a radio cannot be un-picked otherwise). This used to append, so
 * the renderer announced "choose one" while the handler accumulated every
 * pick — the defect in issue #383. The returned shape stays an array because a
 * pick composes with the note; only its length is constrained.
 */
export function toggleSinglePick(selected, label) {
  const list = Array.isArray(selected) ? selected : [];
  return list.includes(label) ? [] : [label];
}

/**
 * The answers that are declared option labels, as opposed to free text.
 *
 * Distinct, so a repeated label counts once. `["A", "A"]` is one choice written
 * twice (a retried request, a client that did not dedupe), not two mutually
 * exclusive options chosen together — and the guard exists for the second thing
 * only. The renderer cannot even produce a duplicate, so this fails open.
 */
export function pickedLabels(answers, optionLabels) {
  const declared = new Set(
    (Array.isArray(optionLabels) ? optionLabels : [])
      .filter((label) => typeof label === "string" && label.length > 0),
  );
  const list = Array.isArray(answers) ? answers : [];
  const matched = list.filter((answer) => typeof answer === "string" && declared.has(answer));
  return [...new Set(matched)];
}

/**
 * Refusal for a question that renders as one choice but arrived with several.
 *
 * Returns null when the batch may proceed, so callers keep one branch. The
 * message names the question, the picks it saw and the single door back — a
 * refusal without an exit is a deadlock with a good error message. An
 * unreadable option list reads every answer as free text and therefore passes:
 * a payload that cannot be parsed must never silence a real answer.
 */
export function exclusivePickRefusal({ question, multiple, answers, optionLabels }) {
  if (multiple === true) return null;
  const picked = pickedLabels(answers, optionLabels);
  if (picked.length <= 1) return null;
  const named = typeof question === "string" && question.trim().length > 0
    ? `"${question.trim()}"`
    : "This question";
  return `Refused: ${named} offers one choice, but ${picked.length} were submitted `
    + `(${picked.join(", ")}). Pick one and submit again — a note may be added alongside it.`;
}

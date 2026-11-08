/**
 * How much of a question batch is still unanswered — and why the button is dead.
 *
 * The submit button is disabled by two independent conditions: the batch is
 * incomplete, or a pick is missing a required note. Only the second one had
 * copy. So an unanswered batch rendered a disabled button with no stated cause,
 * which is exactly the "disabled control with no stated cause is a dead end"
 * rule this codebase states in `submitBlockReason`'s own docstring.
 *
 * The counters that used to carry "N questions remain. Answer it before
 * submitting." were removed on 2026-10-18 with the panel frame, and nothing
 * took over that job (issue #384). This is that job, kept pure so the footer
 * reads one rule and a test can pin the wording without a browser.
 */

/**
 * The reason a batch cannot be submitted yet, or null when nothing is missing.
 *
 * `isResolved` is the caller's own completion predicate (the same one the step
 * dots read), so this module never guesses what "answered" means. Unusable
 * input degrades to "nothing missing" rather than throwing: the footer calls
 * this on every render, and a predicate that arrives malformed must not blank
 * the form.
 *
 * `canSkip` decides whether the sentence may name skipping. It defaults to
 * FALSE on purpose: the recovery (expired) form renders no skip control, so
 * telling that reader "answer or skip it" names a door that is not on the
 * page — a refusal whose exit does not exist is worse than one that names a
 * single real exit. Only a caller that knows skip is rendered may promise it.
 */
export function incompleteBatchReason(questions, isResolved, canSkip = false) {
  const list = Array.isArray(questions) ? questions : [];
  const resolved = typeof isResolved === "function" ? isResolved : () => true;
  const open = list.filter((entry) => entry && typeof entry === "object" && !resolved(entry.id));
  if (open.length === 0) return null;
  const skippable = canSkip === true;
  if (open.length === 1) {
    return skippable
      ? "1 question remains. Answer or skip it before submitting."
      : "1 question remains. Answer it before submitting.";
  }
  return skippable
    ? `${open.length} questions remain. Answer or skip them before submitting.`
    : `${open.length} questions remain. Answer them before submitting.`;
}

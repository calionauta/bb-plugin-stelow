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
 * The sentence always names a door — answering or skipping — because the button
 * stays disabled until one of them happens.
 */
export function incompleteBatchReason(questions, isResolved) {
  const list = Array.isArray(questions) ? questions : [];
  const resolved = typeof isResolved === "function" ? isResolved : () => true;
  const open = list.filter((entry) => entry && typeof entry === "object" && !resolved(entry.id));
  if (open.length === 0) return null;
  if (open.length === 1) return "1 question remains. Answer or skip it before submitting.";
  return `${open.length} questions remain. Answer or skip them before submitting.`;
}

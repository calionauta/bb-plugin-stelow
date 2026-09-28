/**
 * What a boundary question is asking, decided once and sent to the card.
 *
 * A boundary has a `kind` — `reaction` or `confirmation` — and until now
 * nothing outside the ledger read it. The card therefore rendered both
 * identically, which is how a question could ask "what was your first
 * reaction?" while listing three options the agent had already generated:
 * the exact inversion the Interface Contrast method forbids, because it
 * replaces the recorded first reaction with the agent's framing.
 *
 * The two kinds are two different moments, so they render as two different
 * moments:
 *
 * - `reaction` — recorded BEFORE the agent has synthesised anything. There is
 *   nothing to pick between yet, so the options are withheld and the notice
 *   says why rather than leaving a reader wondering where they went.
 * - `confirmation` — recorded AFTER synthesis, on a bounded set of options.
 *   The list is the point, so it stays.
 *
 * This is a presentation decision, so it is computed here and sent whole
 * (`showOptions` + copy), keeping the card a terminal that renders rather
 * than a second place that re-implements the rule. The same convention
 * already carries `splitAction` down to the UI.
 *
 * A question with no boundary is not a boundary question: it gets no framing
 * and keeps today's behaviour, because most card questions are ordinary ones.
 */

const KINDS = new Set(["reaction", "confirmation"]);

/**
 * The boundary id a question carries, or null.
 *
 * `[Stelow boundary <id>]` is the protocol the host already depends on: the
 * reconcile tells the worker to include it, and it is what flips the run's
 * needs-input-sent marker. Reading it back is the same correlation in the
 * other direction, so a question can be tied to the boundary that produced it
 * without adding a column or a second identifier.
 */
export function boundaryIdFromQuestion(question) {
  if (typeof question !== "string") return null;
  const match = question.match(/\[Stelow boundary ([A-Za-z0-9][A-Za-z0-9_-]*)\]/);
  return match ? match[1] : null;
}

/**
 * The framing a boundary question carries, or null when it is not one.
 *
 * @param {unknown} kind the boundary's `kind`
 * @param {{ hasOptions?: boolean }} authored what the question actually carries
 */
export function boundaryQuestionShape(kind, { hasOptions = false } = {}) {
  if (!KINDS.has(kind)) return null;
  if (kind === "confirmation") {
    return {
      kind,
      showOptions: true,
      heading: "Pick the option to carry forward",
      notice: null,
    };
  }
  return {
    kind,
    // A reaction is answered in the reader's own words. Options authored on a
    // reaction boundary are withheld here rather than rendered, and the
    // notice names the withholding instead of leaving a silent gap.
    showOptions: false,
    heading: "First reaction — before any comparison",
    notice: hasOptions
      ? "Recorded before the comparison: answer in your own words. The generated options are withheld until your reaction is on the record."
      : "Recorded before the comparison: answer in your own words. The agent's options come after this.",
  };
}

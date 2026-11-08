/**
 * Which door an Inbox row's question opens.
 *
 * A row about a question is two things at once: a notification, and a door onto
 * the decision it names. Opening the whole card to answer one question means
 * loading nine sections to reach one of them, so the row can offer a second,
 * narrower door: the question itself, the description's collapsed line, and the
 * option rows — and nothing else.
 *
 * That shortcut is only safe when the narrower door still carries everything the
 * decision needs. So this is a gate, not a preference, and every refusal names
 * where the reader goes instead rather than leaving them on a row that silently
 * did nothing.
 *
 * Two doors on one row would be a UI defect on their own (one click, two
 * meanings), which is why the CALLER pairs this with a fixed click: the row's
 * click always opens the card, and the direct door is reached by an explicit
 * keypress the row's own copy names. This function only decides whether that
 * explicit door exists.
 */

/** The reasons a question row opens the card instead of the direct view. */
export const QUESTION_ROUTE_REFUSALS = {
  "not-a-question": "Only a question row has a decision to open.",
  "no-document-viewer": "The evidence a question usually attaches cannot be opened here.",
  "split-creates-cards": "Answering this one creates child cards, which is a card-scoped consequence.",
};

/**
 * @param event              an Inbox event, or null
 * @param options.hasDocumentViewer  whether this host can open a card document
 *                                   (the same condition `openAskArtifact` needs)
 * @param options.hasSplitQuestion   whether ANY open question in the row's batch
 *                                   is a split proposal
 * @returns `{ route: "direct", reason }` or `{ route: "card", reason, exit }`
 *          where `exit` is human-readable and always names a real destination.
 */
export function inboxQuestionRoute(event, options = {}) {
  const { hasDocumentViewer = false, hasSplitQuestion = false } = options ?? {};

  const refuse = (reason) => ({
    route: "card",
    reason,
    exit: QUESTION_ROUTE_REFUSALS[reason],
  });

  if (event == null || typeof event !== "object" || event.kind !== "question") {
    return refuse("not-a-question");
  }
  // A split question's answer CREATE CHILD CARDS and archive the parent. That is
  // a consequence of the card, not of the question, and its keep-versus-deliver
  // exclusivity notice belongs where the card is — so the row sends the reader
  // there rather than offering a narrow door onto a card-wide decision.
  if (hasSplitQuestion) return refuse("split-creates-cards");
  if (!hasDocumentViewer) return refuse("no-document-viewer");
  return { route: "direct", reason: "question-with-evidence" };
}

/** Whether an event row is a question this gate would consider at all. */
export function isQuestionRouteCandidate(event) {
  return event != null && typeof event === "object" && event.kind === "question";
}

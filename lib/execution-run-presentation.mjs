/**
 * Where the live progress of a run is, for a reader holding only the card.
 *
 * The ledger stores the native run's `previewDirective`, and it is a chat
 * token: BB renders it as live progress inside the conversation. No card
 * surface can render it, and `executionRunDeepLink` already refuses to treat
 * a native run id as a Stelow route on purpose. So the directive is not
 * missing from the card by accident — printing it raw would show a reader a
 * machine token that does nothing when clicked.
 *
 * What was genuinely missing is the destination itself: an active run showed
 * a state label and nothing else, which reads as a spinner with nowhere to
 * look. The row now says where to look instead of implying the card has
 * progress.
 *
 * Only a run that is actually moving gets a note. A `needs_input` run is
 * paused — the question on the card is its progress — and a finished run has
 * none, so both get nothing rather than a stale pointer.
 */
export function liveProgressNote(status) {
  if (status === "queued" || status === "running") {
    return "Live step progress streams in the card's thread.";
  }
  return null;
}

/**
 * The attention window and the audit-stage resume nudge.
 *
 * Deterministic sweep plus lifecycle polling share one attention window: an
 * idle card becomes actionable only after two reconcile cycles. The nudge is
 * the copy an audit-idle resume sends — reaching audit is not completing; the
 * worker commits with `bb stelow done`, and the host verifies in code, so
 * narrating completion without running done leaves the card waiting.
 */
export const IDLE_ATTENTION_MS = 90_000;

export const AUDIT_DONE_NUDGE =
  "The workflow is at the audit stage. If audit work remains, finish it first. Then commit completion with `bb stelow done` — it verifies in \
code and refuses with the fix when something is missing. Two dead ends this nudge exists to close: when `done` refuses, do not mark the \
blocking work done to get past it — a false completion claim is worse than an open card — and do not end this turn with a question in \
prose, because the host cannot see prose and the card parks with nothing answerable. Name the blocker in a card comment, and when a human \
decision is genuinely required, open it with `bb stelow ask` so the card carries a question someone can answer. Never just announce \
completion and stop: only done completes the card.";

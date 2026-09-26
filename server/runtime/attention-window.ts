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
" +
  "code and refuses with the fix when something is missing. Never just announce completion and stop: only done completes the card.";

const TRACKS = new Set(["inbox", "build", "research", "explore"]);
const STATES = new Set(["queued", "running", "needs_input", "succeeded", "failed", "cancelled"]);
const CARD_ID = /^card_[A-Za-z0-9]+$/;
const LOCAL_RUN_ID = /^exec_[A-Za-z0-9][A-Za-z0-9_-]*$/;

const FOCUS_BY_STATE = {
  queued: "run",
  running: "run",
  needs_input: "question",
  succeeded: "history",
  failed: "history",
  cancelled: "history",
};

/**
 * Return the supported in-app deep link for a ledger run.
 *
 * The ledger's local id is the only navigation identity. Native run ids and
 * preview directives are adapter/UI evidence, not Stelow routes.
 */
export function executionRunDeepLink({ track, cardId, localRunId, status } = {}) {
  if (!TRACKS.has(track) || typeof cardId !== "string" || !CARD_ID.test(cardId) || typeof localRunId !== "string" || !LOCAL_RUN_ID.test(localRunId) || !STATES.has(status)) return null;
  return {
    kind: "card-run",
    track,
    cardId,
    localRunId,
    status,
    focus: FOCUS_BY_STATE[status],
  };
}

export function executionRunSubPath(input) {
  const link = executionRunDeepLink(input);
  return link ? `${link.track}/card/${link.cardId}/run/${link.localRunId}` : null;
}

/**
 * The DOM id of one run's own row, and nothing else.
 *
 * This is deliberately separate from `executionRunFocus`. A run row and a deep
 * link used to share one derivation, so a `needs_input` run's row claimed the
 * id `execution-needs-input-questions` — which is ALSO the card's question
 * section's id. Two elements, one id: `getElementById` returned whichever came
 * first, and the focus effect was looking for a third thing entirely. A run row
 * names itself; what a deep link aims at is a different question.
 */
export function executionRunRowId(localRunId) {
  return typeof localRunId === "string" && LOCAL_RUN_ID.test(localRunId)
    ? `execution-run-${localRunId}`
    : null;
}

/**
 * Where a deep link aims: the run's own row, except for a run waiting on a
 * person, where the answerable question is the point.
 */
export function executionRunFocus({ localRunId, status, hasQuestion = false } = {}) {
  if (typeof localRunId !== "string" || !LOCAL_RUN_ID.test(localRunId) || !STATES.has(status)) return null;
  if (status === "needs_input" && hasQuestion) return "execution-needs-input-questions";
  return executionRunRowId(localRunId);
}

export function parseExecutionRunSubPath(subPath) {
  const normalized = String(subPath ?? "").replace(/^\/+|\/+$/g, "");
  const match = normalized.match(/^(?:(inbox|build|research|explore)\/)?card\/(card_[A-Za-z0-9]+)(?:\/event\/(evt_[A-Za-z0-9]+))?\/run\/(exec_[A-Za-z0-9][A-Za-z0-9_-]*)$/);
  if (!match) return null;
  return { track: match[1] ?? null, cardId: match[2], eventId: match[3] ?? null, localRunId: match[4] };
}

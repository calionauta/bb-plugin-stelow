// Card lifecycle controls must agree with the card state. Keep this pure and
// shared so a visual convenience cannot reopen a terminal card or imply that
// a healthy, active worker needs recovery.
export function isArchivedCard(card) {
  return card?.status === "archived";
}

// Archived is terminal: no background poll, event, or error path may move a
// card back out (e.g. a stopping worker thread settling after Archive must
// not flip the card to completed). updateCard strips such resuscitations so
// every current and future writer is covered by one rule. Archiving itself
// (anything -> archived) and idempotent re-archives always pass through.
export function stripArchivedResuscitation(previousStatus, fields) {
  if (previousStatus !== "archived" || fields == null) return fields;
  if (fields.status === undefined || fields.status === "archived") return fields;
  const { status: _dropped, ...rest } = fields;
  return rest;
}

export function workerActionPolicy(card, needsAttention = false) {
  const archived = isArchivedCard(card);
  const hasActiveWorker = card?.activity === "running" || card?.activity === "awaiting-answer";
  const recoverable = card?.activity === "error"
    || (card?.activity === "idle" && needsAttention);

  return {
    archived,
    hasActiveWorker,
    showPresetControls: !archived,
    showRestartFresh: !archived && recoverable,
    showArchive: !archived,
    showDelete: archived,
  };
}

export function workerSectionPolicy(card, needsAttention = false, { hasGithubLink = false, historyCount = 0 } = {}) {
  const actions = workerActionPolicy(card, needsAttention);
  return {
    ...actions,
    showSection: actions.showPresetControls || hasGithubLink || historyCount > 0,
  };
}

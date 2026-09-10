// Controls that change a worker's lifecycle must agree with the card state.
// Keep this pure and shared so a visual convenience cannot reopen a terminal
// card or imply that a healthy, active worker needs recovery.
export function isArchivedCard(card) {
  return card?.status === "archived";
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

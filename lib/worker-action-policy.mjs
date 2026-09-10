// Controls that change a worker's lifecycle must agree with the card state.
// Keep this pure and shared so a visual convenience cannot reopen a terminal
// card or imply that a healthy, active worker needs recovery.
export function isArchivedCard(card) {
  return card?.status === "archived";
}

export function workerActionPolicy(card, needsAttention = false) {
  const archived = isArchivedCard(card);
  const recoverable = card?.activity === "error"
    || (card?.activity === "idle" && needsAttention);

  return {
    archived,
    showPresetControls: !archived,
    showRestartFresh: !archived && recoverable,
    showStopAndArchive: !archived,
    showDelete: archived,
  };
}

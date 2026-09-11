// Terminal cards keep their workflow record, but must never read as live work.
// One presentation contract prevents hero, history, and empty-state copy from
// drifting apart across card-detail surfaces.
export function archivedCardDetailPresentation(card, stageLabel) {
  if (card?.status !== "archived") return null;
  return {
    hero: {
      kind: "calm",
      title: "Archived",
      sub: "This card is kept for reference. No action is needed.",
    },
    workflow: {
      title: "Workflow history",
      hint: `Ended at ${stageLabel(card.stage)}`,
      emptyScopes: "No scopes were created before this card was archived.",
      progressTitle: "Workflow progress",
      progressHint: "Archived before completion",
    },
  };
}

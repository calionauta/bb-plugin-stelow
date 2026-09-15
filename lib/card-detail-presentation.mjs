// Terminal cards keep their workflow record, but must never read as live work.
// One presentation contract prevents hero, history, and empty-state copy from
// drifting apart across card-detail surfaces.
//
// The live card's progress block is titled "Workflow progress". An archived
// card is history, not progress, so it renames the section — the block itself
// carries no heading of its own, since the disclosure summary already names it
// and states where the card ended.
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
    },
  };
}

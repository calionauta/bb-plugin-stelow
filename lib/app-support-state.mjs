export function activeCardCount(cards) {
  return cards.filter((card) => card.status !== "completed" && card.status !== "archived").length;
}

export function accessoryTone(count, activeTone) {
  return count > 0 ? activeTone : "bg-muted text-muted-foreground";
}

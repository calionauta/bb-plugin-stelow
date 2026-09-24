export function activeCardCount(cards) {
  return cards.filter((card) => card.status !== "completed" && card.status !== "archived").length;
}

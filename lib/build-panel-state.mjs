import { buildBoardColumnFor } from "./workflow-vocabulary.mjs";
import { matchesFilterValue } from "./kanban-layout.mjs";

export function filterAndGroupBuildCards(cards, filters) {
  const filtered = cards.filter((card) => buildCardMatches(card, filters));
  const groups = Object.fromEntries(
    filters.columns.map((column) => [column, []]),
  );
  for (const card of filtered) {
    (groups[buildBoardColumnFor(card)] ?? groups.analysis).push(card);
  }
  for (const column of Object.keys(groups)) {
    groups[column].sort((left, right) => right.updatedAt - left.updatedAt);
  }
  return groups;
}

export function buildCardMatches(card, filters) {
  if (!matchesFilterValue(filters.projectIds, card.projectId)) return false;
  if (!matchesFilterValue(filters.intents, card.intent)) return false;
  if (!matchesFilterValue(filters.statuses, buildBoardColumnFor(card))) return false;
  if (!matchesFilterValue(filters.activities, card.activity)) return false;
  if (!matchesFilterValue(filters.stages, card.stage)) return false;
  return !filters.attention || card.needsAttention;
}

export function reviewGatesAfterDefaults(current, defaults, hasStoredSelection) {
  return hasStoredSelection ? current : defaults;
}

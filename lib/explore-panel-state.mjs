import { LIGHTWEIGHT_COLUMNS, lightweightColumnForStatus } from "./tracks.mjs";
import { matchesFilterValue } from "./kanban-layout.mjs";

export function exploreCardListRequest(projectId) {
  return { projectId, kind: "explore" };
}

export function exploreCardMatches(card, filters) {
  if (!matchesFilterValue(filters.projectIds, card.projectId)) return false;
  return !filters.attention || card.needsAttention;
}

export function filterAndGroupExploreCards(cards, filters) {
  const groups = Object.fromEntries(
    filters.columns.map((column) => [column, []]),
  );
  for (const card of cards.filter((entry) => exploreCardMatches(entry, filters))) {
    (groups[lightweightColumnForStatus(card.status)] ?? groups.inbox).push(card);
  }
  for (const column of Object.keys(groups)) {
    groups[column].sort((left, right) => right.updatedAt - left.updatedAt);
  }
  return groups;
}

export function techniqueLabelsById(stages) {
  return new Map(stages.map((stage) => [stage.id, stage.label]));
}

export function explorePresetFor(presets, assignments) {
  const fallback = presets.find((preset) => preset.isDefault) ?? presets[0] ?? null;
  const assignment = assignments.find((entry) => entry.band === "explore");
  const assigned = presets.find((preset) => preset.id === assignment?.presetId) ?? null;
  return {
    preset: assigned ?? fallback,
    hasBandPreset: assigned !== null,
  };
}

export async function moveExploreCard(moveCard, cardId, target, onError) {
  if (!LIGHTWEIGHT_COLUMNS.includes(target)) return;
  const result = await moveCard(cardId, target);
  if (!result.ok) onError(result.error ?? "Move failed");
}

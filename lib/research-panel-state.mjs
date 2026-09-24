import { lightweightColumnForStatus } from "./tracks.mjs";
import { matchesFilterValue } from "./kanban-layout.mjs";

export function researchCardMatches(card, filters) {
  if (!matchesFilterValue(filters.projectIds, card.projectId)) return false;
  return !filters.attention || card.needsAttention;
}

export function filterAndGroupResearchCards(cards, filters) {
  const groups = Object.fromEntries(
    filters.columns.map((column) => [column, []]),
  );
  for (const card of cards.filter((entry) => researchCardMatches(entry, filters))) {
    (groups[lightweightColumnForStatus(card.status)] ?? groups.inbox).push(card);
  }
  for (const column of Object.keys(groups)) {
    groups[column].sort((left, right) => right.updatedAt - left.updatedAt);
  }
  return groups;
}

export function strategyLabelsById(strategies) {
  return new Map(strategies.map((strategy) => [strategy.id, strategy.label]));
}

export function researchPresetFor(presets, assignments) {
  const fallback = presets.find((preset) => preset.isDefault) ?? presets[0] ?? null;
  const assignment = assignments.find((entry) => entry.band === "research");
  const assigned = presets.find((preset) => preset.id === assignment?.presetId) ?? null;
  return {
    preset: assigned ?? fallback,
    hasBandPreset: assigned !== null,
  };
}

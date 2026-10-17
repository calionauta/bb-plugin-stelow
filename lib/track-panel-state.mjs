import { lightweightColumnForStatus } from "./tracks.mjs";
import { matchesFilterValue } from "./kanban-layout.mjs";

export const EXPLORE_TRACK_CONFIG = { kind: "explore", band: "explore" };
export const RESEARCH_TRACK_CONFIG = { kind: "research", band: "research" };

export function trackCardListRequest(kind, projectId) {
  return { projectId, kind };
}

export function trackCardMatches(card, filters) {
  if (!matchesFilterValue(filters.projectIds, card.projectId)) return false;
  return !filters.attention || card.needsAttention;
}

export function filterAndGroupTrackCards(cards, filters) {
  const groups = Object.fromEntries(
    filters.columns.map((column) => [column, []]),
  );
  for (const card of cards.filter((entry) => trackCardMatches(entry, filters))) {
    (groups[lightweightColumnForStatus(card.status)] ?? groups.inbox).push(card);
  }
  for (const column of Object.keys(groups)) {
    groups[column].sort((left, right) => right.updatedAt - left.updatedAt);
  }
  return groups;
}

export function trackLabelsById(items) {
  return new Map(items.map((item) => [item.id, item.label]));
}

export function trackPresetFor(presets, assignments, band) {
  const fallback = presets.find((preset) => preset.isDefault) ?? presets[0] ?? null;
  const assignment = assignments.find((entry) => entry.band === band);
  const assigned = presets.find((preset) => preset.id === assignment?.presetId) ?? null;
  return {
    preset: assigned ?? fallback,
    hasBandPreset: assigned !== null,
  };
}

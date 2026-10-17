import {
  RESEARCH_TRACK_CONFIG,
  filterAndGroupTrackCards,
  trackCardListRequest,
  trackCardMatches,
  trackLabelsById,
  trackPresetFor,
} from "./track-panel-state.mjs";

export function researchCardListRequest(projectId) {
  return trackCardListRequest(RESEARCH_TRACK_CONFIG.kind, projectId);
}

export function researchCardMatches(card, filters) {
  return trackCardMatches(card, filters);
}

export function filterAndGroupResearchCards(cards, filters) {
  return filterAndGroupTrackCards(cards, filters);
}

export function strategyLabelsById(strategies) {
  return trackLabelsById(strategies);
}

export function researchPresetFor(presets, assignments) {
  return trackPresetFor(presets, assignments, RESEARCH_TRACK_CONFIG.band);
}

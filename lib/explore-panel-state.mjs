import {
  EXPLORE_TRACK_CONFIG,
  filterAndGroupTrackCards,
  trackCardListRequest,
  trackCardMatches,
  trackLabelsById,
  trackPresetFor,
} from "./track-panel-state.mjs";

export function exploreCardListRequest(projectId) {
  return trackCardListRequest(EXPLORE_TRACK_CONFIG.kind, projectId);
}

export function exploreCardMatches(card, filters) {
  return trackCardMatches(card, filters);
}

export function filterAndGroupExploreCards(cards, filters) {
  return filterAndGroupTrackCards(cards, filters);
}

export function techniqueLabelsById(stages) {
  return trackLabelsById(stages);
}

export function explorePresetFor(presets, assignments) {
  return trackPresetFor(presets, assignments, EXPLORE_TRACK_CONFIG.band);
}

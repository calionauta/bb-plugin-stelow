import { createResearchIndexViewHandlers } from "./research-index-view.js";
import { createResearchFanoutHandler } from "./research-fanout.js";
import { createResearchStrategyRoundHandler } from "./research-strategy-rounds.js";
import type { ResearchTrackDeps } from "./research-track-deps.js";

/** The research/explore track RPC surface, assembled from one slice per
 * lifecycle: the card catalog and index read, the fan-out that turns index
 * opportunities into build cards, and the strategy round that appends a new
 * section to an existing card. The composition root supplies the wiring once;
 * this file only declares which handler belongs to which slice, so the
 * registered contract stays readable as a single object. */
export function createResearchTrackHandlers(deps: ResearchTrackDeps) {
  return {
    ...createResearchIndexViewHandlers(deps),
    fanOutResearch: createResearchFanoutHandler(deps),
    runResearchStrategy: createResearchStrategyRoundHandler(deps),
  };
}

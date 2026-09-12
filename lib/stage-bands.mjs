/**
 * Stage-to-band mapping (preset routing + board grouping). Single source of
 * truth: workflow-vocabulary owns the table; this compatibility module keeps
 * existing consumers stable. Every card kind owns its band: build phases
 * share analysis/planning/execution/review, research and explore each have
 * their own — changing one track's default never leaks into another.
 */
export { STAGE_BANDS, STAGE_TO_BAND } from "./workflow-vocabulary.mjs";

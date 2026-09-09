/**
 * Stage-to-band mapping (preset routing + board grouping). Single source of
 * truth: server.ts, app.tsx and test_bands.mjs all consume this module —
 * never duplicate the table elsewhere. Every card kind owns its band:
 * build phases share analysis/planning/execution/review, research and
 * explore each have their own — changing one track's default never leaks
 * into another.
 */
export const STAGE_BANDS = {
  analysis: ["triage", "select", "setup", "context", "shape"],
  planning: ["critique", "gate", "scope", "interface", "int-gate", "selection", "planning", "plan-gate"],
  execution: ["execution", "verification"],
  review: ["diff-gate", "audit"],
  research: ["research"],
  explore: ["explore"],
};

export const STAGE_TO_BAND = Object.fromEntries(
  Object.entries(STAGE_BANDS).flatMap(([band, stages]) => stages.map((stage) => [stage, band])),
);

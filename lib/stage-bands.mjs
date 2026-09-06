/**
 * Stage-to-band mapping (preset routing + board grouping). Single source of
 * truth: server.ts, app.tsx and test_bands.mjs all consume this module —
 * never duplicate the table elsewhere.
 */
export const STAGE_BANDS = {
  analysis: ["triage", "select", "setup", "context", "shape"],
  planning: ["critique", "gate", "scope", "interface", "int-gate", "selection", "planning", "plan-gate"],
  execution: ["execution", "verification"],
  review: ["diff-gate", "audit"],
  research: ["research"],
};

export const STAGE_TO_BAND = Object.fromEntries(
  Object.entries(STAGE_BANDS).flatMap(([band, stages]) => stages.map((stage) => [stage, band])),
);

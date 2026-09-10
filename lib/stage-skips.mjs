/**
 * Skipped vs off-route stages. The timeline must never paint everything the
 * same green: stages a workflow will never run are either off its intent
 * route (e.g. interface design on a bugfix) or skipped by its review mode
 * (e.g. plan-gate in Auto). Both render distinctly from upcoming, with the
 * reason in the tooltip.
 *
 * Single source in code for the rule SHAPE; the vendored
 * `skills/stelow-workflow-orchestrator/references/transitions.md` stays the
 * methodology source — tests/stage-skips pins the two together (stub
 * routes + gate table), so upstream edits fail loudly here instead of
 * drifting silently.
 */

export const INTENT_ROUTES = {
  "new-product": ["triage", "select", "setup", "context", "shape", "critique", "gate", "scope", "interface", "int-gate", "selection", "planning", "plan-gate", "execution", "verification", "diff-gate", "audit"],
  feature: ["triage", "select", "setup", "context", "shape", "critique", "gate", "scope", "interface", "int-gate", "selection", "planning", "plan-gate", "execution", "verification", "diff-gate", "audit"],
  bugfix: ["triage", "select", "setup", "context", "shape", "critique", "gate", "execution", "verification", "audit"],
  refactor: ["triage", "select", "setup", "context", "planning", "plan-gate", "execution", "verification", "audit"],
  investigate: ["triage", "select", "setup", "context", "audit"],
};

/** Review modes that bypass each gated stage (transitions.md Gate Conditions). */
export const MODE_SKIPS = {
  "plan-gate": ["Auto", "Product Spec Gate"],
  "diff-gate": ["Auto", "Product Spec Gate", "Product Spec + Interface + Scopes"],
  selection: ["Auto", "Product Spec Gate"],
};

/** Stages skipped entirely outside Auto (transitions.md Gate Conditions). */
export const NON_AUTO_SKIPS = ["context"];

/** Known review modes (REVIEW_MODE_OPTIONS). Unknown modes fail open. */
export const REVIEW_MODES = [
  "Auto",
  "Product Spec Gate",
  "Product Spec + Interface Gates",
  "Product Spec + Interface + Scopes",
  "Product Spec + Interface + Tech Review",
  "Product Spec + Interface + Tech Review + Code Diff",
];

export function skipReason(stage, reviewMode) {
  if (stage === "selection") return `Decided by the agent in ${reviewMode} — no human pick`;
  if (stage === "context") return `Skipped entirely in ${reviewMode} review mode`;
  return `Skipped in ${reviewMode} review mode`;
}

/**
 * Split a track's stages into off-route (not in this intent's pipeline)
 * and mode-skipped (in route, bypassed by review mode). Unknown intents
 * (pre-triage) and unknown review modes yield empty lists — never invent
 * a skip. Non-build tracks have no stages: always empty.
 */
export function skippedStages({ kind, intent, reviewMode, sequence }) {
  const empty = { offRoute: [], skipped: [] };
  if (kind !== "build") return empty;
  const route = INTENT_ROUTES[intent];
  if (!Array.isArray(route)) return empty;
  const seq = Array.isArray(sequence) ? sequence : [];
  const offRoute = seq.filter((stage) => !route.includes(stage));
  const skipped = [];
  if (typeof reviewMode === "string" && REVIEW_MODES.includes(reviewMode)) {
    for (const [stage, modes] of Object.entries(MODE_SKIPS)) {
      if (route.includes(stage) && modes.includes(reviewMode)) {
        skipped.push({ stage, reason: skipReason(stage, reviewMode) });
      }
    }
    if (reviewMode !== "Auto" && route.includes("context")) {
      skipped.push({ stage: "context", reason: skipReason("context", reviewMode) });
    }
  }
  return { offRoute, skipped };
}

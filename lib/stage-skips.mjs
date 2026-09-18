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
 * drifting silently. Review gates resolve to sets internally (ladder in,
 * sets internally): an explicit `reviewGates` array uses set semantics
 * (plan-gate waits on `tech`, diff-gate on `diff`, selection on
 * `interface`); a legacy `reviewMode` string normalizes through the compat
 * map first, so the six ladder rungs behave exactly as before.
 */

import { diffGateWaits, legacyLabelForGates, normalizeReviewGates, planGateWaits, skipReasonForGate } from "./review-gates.mjs";

export const INTENT_ROUTES = {
  "new-product": ["triage", "select", "setup", "context", "shape", "critique", "gate", "scope", "interface", "int-gate", "selection", "planning", "plan-gate", "execution", "verification", "diff-gate", "audit"],
  feature: ["triage", "select", "setup", "context", "shape", "critique", "gate", "scope", "interface", "int-gate", "selection", "planning", "plan-gate", "execution", "verification", "diff-gate", "audit"],
  bugfix: ["triage", "select", "setup", "context", "shape", "critique", "gate", "execution", "verification", "audit"],
  refactor: ["triage", "select", "setup", "context", "planning", "plan-gate", "execution", "verification", "audit"],
  investigate: ["triage", "select", "setup", "context", "audit"],
};

/** Review modes that bypass each gated stage (transitions.md Gate Conditions). */
export const MODE_SKIPS = {
  "plan-gate": ["Auto", "Product Spec Gate", "Product Spec + Interface + Scopes"],
  "diff-gate": ["Auto", "Product Spec Gate", "Product Spec + Interface + Scopes"],
  selection: ["Auto", "Product Spec Gate"],
};

/** Context policy is appetite/intent-specific; `context:5` decides it upstream. */
export const NON_AUTO_SKIPS = [];

/** Know the ladder for validation; enforcement resolves to gate sets. */
export const REVIEW_MODES = [
  "Auto",
  "Product Spec Gate",
  "Product Spec + Interface Gates",
  "Product Spec + Interface + Scopes",
  "Product Spec + Interface + Tech Review",
  "Product Spec + Interface + Tech Review + Code Diff",
];

/**
 * Per-gate wait predicate over the set: which gated stages run. A set
 * that exactly equals a ladder rung behaves exactly like that rung did
 * (RFC §5) — the ladder's gate table is non-monotonic on purpose
 * (Interface Gates runs plan-gate and diff-gate while Scopes skips
 * both), so novel sets follow the canonical per-atom matrix while exact
 * rung sets keep the pinned table behavior.
 */
export function gateWaitsStage(stage, gates) {
  const normalized = normalizeReviewGates(gates);
  const rung = legacyLabelForGates(normalized);
  if (rung) return !(MODE_SKIPS[stage] ?? []).includes(rung);
  if (stage === "plan-gate") return planGateWaits(normalized);
  if (stage === "diff-gate") return diffGateWaits(normalized);
  if (stage === "selection") return normalized.includes("interface");
  return true;
}

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
 *
 * Set callers pass `reviewGates` (an explicit atom array): skips resolve
 * per gate and reasons name the missing gate. Ladder callers pass
 * `reviewMode` (a legacy string): it normalizes through the compat map
 * first and reasons keep naming the rung, exactly as before.
 */
export function skippedStages({ kind, intent, reviewMode, reviewGates, sequence }) {
  const empty = { offRoute: [], skipped: [] };
  if (kind !== "build") return empty;
  const route = INTENT_ROUTES[intent];
  if (!Array.isArray(route)) return empty;
  const seq = Array.isArray(sequence) ? sequence : [];
  const offRoute = seq.filter((stage) => !route.includes(stage));
  const skipped = [];
  if (reviewGates !== undefined) {
    const gates = normalizeReviewGates(reviewGates);
    for (const stage of Object.keys(MODE_SKIPS)) {
      if (route.includes(stage) && !gateWaitsStage(stage, gates)) {
        skipped.push({ stage, reason: skipReasonForGate(stage, gates) });
      }
    }
    return { offRoute, skipped };
  }
  if (typeof reviewMode === "string" && REVIEW_MODES.includes(reviewMode)) {
    for (const [stage, modes] of Object.entries(MODE_SKIPS)) {
      if (route.includes(stage) && modes.includes(reviewMode)) {
        skipped.push({ stage, reason: skipReason(stage, reviewMode) });
      }
    }
  }
  return { offRoute, skipped };
}

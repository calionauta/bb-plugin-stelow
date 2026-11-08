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
import { WORKFLOW_ROUTES } from "./workflow-catalog.mjs";
import { stagesAbsentByPolicy } from "./workflow-moves.mjs";

export const INTENT_ROUTES = WORKFLOW_ROUTES.intents ?? {};

/**
 * Review modes that bypass each gated stage, projected from stages.yaml.
 *
 * Upstream splits the vocabulary in two, and the union is what the timeline
 * needs because both mean "not a human stop":
 *
 *   skipped       — the stage DOES NOT RUN. plan-gate in Auto has nobody to
 *                   approve it, so it does not exist.
 *   no_human_wait — the stage DOES run, but it never parks for a person:
 *                   `selection` in Auto is decided by the agent.
 *
 * The move rule does not read this union: it reads each mode's `skipped` list
 * from the catalog itself (lib/workflow-moves.mjs), because bypassing
 * `selection` would hand the next stage a prose interface with no graph.
 */
const MODE_SKIPS_BY_STAGE = {};
for (const [mode, route] of Object.entries(WORKFLOW_ROUTES.review_modes ?? {})) {
  for (const stage of route.skipped ?? []) {
    (MODE_SKIPS_BY_STAGE[stage] ??= []).push(mode);
  }
  for (const stage of route.no_human_wait ?? []) {
    (MODE_SKIPS_BY_STAGE[stage] ??= []).push(mode);
  }
}
export const MODE_SKIPS = MODE_SKIPS_BY_STAGE;

/** Know the ladder for validation; enforcement resolves to gate sets. */
export const REVIEW_MODES = Object.keys(WORKFLOW_ROUTES.review_modes ?? {});

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
/**
 * The reason a policy skip carries.
 *
 * Distinct from the review-mode wording on purpose: a mode says "no approver in
 * this rung", a policy says "this run does not do that work". Collapsing them
 * into one sentence would make the timeline unable to explain why a stage
 * disappears without changing the rung.
 */
const POLICY_SKIP_REASON = "the card's run policy excludes it (quality / exploration count)";

/**
 * Stages the card's stage policies remove, appended to a mode's skips.
 *
 * Without this the timeline knew only review modes and review gates, so
 * `context` could never be painted skipped: its exclusion lives in
 * `routes.stage_policies`, which only the move path read. The panel then offered
 * a stage `bb stelow advance context` refuses for that same configuration — the
 * disagreement the projection exists to prevent, in the timeline instead of the
 * button.
 */
function withPolicySkips(skipped, { route, reviewMode, quality, explorationCount }) {
  const absent = stagesAbsentByPolicy({
    review_mode: reviewMode,
    quality,
    exploration_count: explorationCount,
  });
  for (const stage of absent) {
    if (!route.includes(stage)) continue;
    if (skipped.some((entry) => entry.stage === stage)) continue;
    skipped.push({ stage, reason: POLICY_SKIP_REASON });
  }
  return skipped;
}

export function skippedStages({ kind, intent, reviewMode, reviewGates, sequence, quality, explorationCount }) {
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
    withPolicySkips(skipped, { route, reviewMode, quality, explorationCount });
    return { offRoute, skipped };
  }
  if (typeof reviewMode === "string" && REVIEW_MODES.includes(reviewMode)) {
    for (const [stage, modes] of Object.entries(MODE_SKIPS)) {
      if (route.includes(stage) && modes.includes(reviewMode)) {
        skipped.push({ stage, reason: skipReason(stage, reviewMode) });
      }
    }
  }
  withPolicySkips(skipped, { route, reviewMode, quality, explorationCount });
  return { offRoute, skipped };
}

/**
 * The timeline's skips, assembled from the detail's own stage-skips block.
 *
 * Three inputs decide which stages do not run — the review rung, the review gates
 * and the card's stage policies — and assembling them at the call site is how one
 * of the three went missing. The caller passes what it has; this maps it.
 */
export function timelineSkips({ kind, intent, stageSkips, sequence }) {
  return skippedStages({
    kind,
    intent,
    sequence,
    reviewMode: stageSkips?.reviewMode,
    reviewGates: stageSkips?.reviewGates,
    quality: stageSkips?.quality,
    explorationCount: stageSkips?.explorationCount,
  });
}

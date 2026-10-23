/**
 * The legal moves from a stage, projected from the published catalog.
 *
 * The panel has to answer "can the human move the card here?" and the
 * helper has to answer "will `stelow advance` accept this?". Those are the
 * same question, and the panel used to answer a coarser one: it read the
 * catalog's transition rows and offered every target — no intent route, no
 * review mode. So the panel offered `diff-gate` in Auto (where the stage
 * does not run) and `planning` at `context` on a bugfix (where the route
 * does not go), and the worker was refused by the helper seconds later.
 *
 * This module is the ONE place in the host that projects the rule. It
 * derives from the same published data the helper parses — the catalog's
 * `routes.intents`, its `routes.review_modes` and its transition rows — so
 * a rule change upstream moves here without a code change. The parity test
 * (`tests/workflow-moves.test.mjs`) runs the PINNED HELPER over the same
 * triples and fails when this projection and the helper disagree.
 *
 * The rule, in the helper's words:
 *
 *   - a stage's transition rows give the candidates;
 *   - the intent route keeps a move only if the target is behind the
 *     current stage, the stage itself, or the route's IMMEDIATE next stage
 *     (everything further ahead is reached through a skipped stage);
 *   - a stage that does not run in this review mode is not a candidate, and
 *     the stage before it may move straight to the stage after it.
 */

import { STAGE_TRANSITIONS, WORKFLOW_ROUTES } from "./workflow-catalog.mjs";
import { diffGateWaits, normalizeReviewGates, planGateWaits } from "./review-gates.mjs";

export const INTENT_ROUTES = WORKFLOW_ROUTES.intents ?? {};
const REVIEW_MODES = WORKFLOW_ROUTES.review_modes ?? {};
const STAGE_POLICIES = WORKFLOW_ROUTES.stage_policies ?? [];

/**
 * The stages that do not RUN under a gate set.
 *
 * A gate set is not a ladder rung, so the ladder's `skipped` list does not
 * apply to it. The atoms carry the same meaning: plan-gate needs `tech` to
 * exist, diff-gate needs `diff`, and `selection` always exists — it just
 * stops asking a human when `interface` is off.
 */
function stagesThatDoNotRun(gates) {
  const normalized = normalizeReviewGates(gates);
  const absent = [];
  if (!planGateWaits(normalized)) absent.push("plan-gate");
  if (!diffGateWaits(normalized)) absent.push("diff-gate");
  return absent;
}

/** The stages that do not run under a ladder rung, read from the catalog. */
function stagesThatDoNotRunForMode(reviewMode) {
  return REVIEW_MODES[reviewMode]?.skipped ?? [];
}

/**
 * The stages that do not run, for either shape of the review policy.
 *
 * A ladder rung is read from the catalog's own `skipped` list — the same
 * list the helper parses — so the two cannot disagree about which stages
 * exist. A gate set resolves through the atom matrix.
 */
function absentStages(reviewPolicy) {
  if (Array.isArray(reviewPolicy)) return stagesThatDoNotRun(reviewPolicy);
  if (typeof reviewPolicy === "string" && REVIEW_MODES[reviewPolicy]) {
    return stagesThatDoNotRunForMode(reviewPolicy);
  }
  return [];
}

/**
 * Does a policy's condition hold for these knobs?
 *
 * The condition shape is the upstream one: a conjunction of `when` keys
 * (each the set of allowed values), plus an optional `any_of`
 * disjunction inside it.
 */
function conditionHolds(condition, knobs) {
  for (const [key, allowed] of Object.entries(condition)) {
    if (key === "any_of") continue;
    if (!allowed.map(String).includes(String(knobs[key] ?? ""))) return false;
  }
  const anyOf = condition.any_of ?? {};
  return Object.entries(anyOf).some(([key, allowed]) =>
    allowed.map(String).includes(String(knobs[key] ?? "")),
  );
}

/**
 * The stages that do not run under the run knobs.
 *
 * The same policy the helper enforces and the same policy the published
 * matrix is rendered from: `stages.yaml` owns it, the catalog publishes
 * it, and both the panel and the helper read it. A stage that does not run
 * leaves a hole in the route, and both fill it the same way.
 */
function stagesAbsentByPolicy(knobs) {
  const absent = [];
  for (const policy of STAGE_POLICIES) {
    const skip = policy.skip;
    if (!skip?.when) continue;
    if (!conditionHolds(skip.when, knobs)) continue;
    if (!absent.includes(policy.stage)) absent.push(policy.stage);
  }
  return absent;
}

/** The stage's transition rows, tagged with the verb each edge came from. */
function candidatesFor(stage) {
  const row = STAGE_TRANSITIONS[stage];
  if (!row) return [];
  const candidates = [];
  for (const [verb, targets] of [
    ["next", row.next],
    ["accept", row.accept],
    ["reject", row.reject],
    ["rework", row.rework],
  ]) {
    for (const target of targets ?? []) {
      if (typeof target === "string" && target) candidates.push({ verb, target });
    }
  }
  return candidates;
}

/**
 * The stages a move may reach, or null when the intent has no route.
 *
 * Behind, the stage itself, and the route's IMMEDIATE next stage. A stage
 * that does not run leaves a hole, and the stage after the hole is reached
 * through the passthrough instead.
 */
function reachableSet(intent, stage) {
  const route = INTENT_ROUTES[intent] ?? null;
  if (!route || !route.includes(stage)) return null;
  const index = route.indexOf(stage);
  return new Set([...route.slice(0, index), stage, ...route.slice(index + 1, index + 2)]);
}

/**
 * The move a stage that does not run leaves behind.
 *
 * The stage before it may move straight to the stage after it — otherwise
 * the workflow deadlocks: refused at the hole, with no legal way past it.
 */
function passthroughTarget(route, absent, stage) {
  if (!route) return null;
  for (const skipped of absent) {
    const index = route.indexOf(skipped);
    if (index <= 0 || index + 1 >= route.length) continue;
    if (route[index - 1] !== stage) continue;
    return route[index + 1];
  }
  return null;
}

/**
 * The candidates a move can reach, split into the whole legal set and the
 * forward one.
 *
 * `allowed` is every move the helper accepts, backward ones included: a
 * reject or a rework must still be reachable. `forward` is the move that
 * goes forward — the one the router takes when the hand-off names a stage
 * the workflow cannot go to.
 */
export function legalMoves({ intent, reviewPolicy, stage, quality, explorationCount }) {
  const candidates = candidatesFor(stage);
  if (candidates.length === 0) return { allowed: [], forward: [] };

  const route = INTENT_ROUTES[intent] ?? null;
  const absent = [
    ...absentStages(reviewPolicy),
    ...stagesAbsentByPolicy({
      quality,
      exploration_count: explorationCount,
      review_mode: typeof reviewPolicy === "string" ? reviewPolicy : undefined,
    }),
  ];
  const reachable = reachableSet(intent, stage);

  const allowed = [];
  const seen = new Set();
  for (const { verb, target } of candidates) {
    if (reachable && !reachable.has(target)) continue;
    if (absent.includes(target)) continue;
    if (seen.has(target)) continue;
    seen.add(target);
    allowed.push({ verb, target });
  }

  const successor = passthroughTarget(route, absent, stage);
  if (successor && !seen.has(successor)) {
    seen.add(successor);
    allowed.push({ verb: "next", target: successor });
  }

  return {
    allowed: allowed.map((move) => move.target),
    forward: allowed
      .filter((move) => move.verb === "next" || move.verb === "accept")
      .map((move) => move.target),
  };
}

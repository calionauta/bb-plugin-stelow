import assert from "node:assert/strict";

import { WALK_INTENTS, WALK_MODES, plannedRoute } from "../lib/workflow-walk.mjs";
import { WORKFLOW_ROUTES } from "../lib/workflow-catalog.mjs";
import { adversarialCells, runCell, walkRoute } from "./helpers/workflow-walk-driver.mjs";

/**
 * A card can walk its whole route with only what the workflow declares, and
 * every refusal it can meet names a way out.
 *
 * The suite already pins the transition TABLE (`transition-totality`: no stage
 * strands a card) and the MOVE projection (`workflow-moves`: the panel and the
 * helper agree about legal targets). Neither runs the state machine end to end,
 * so neither can see the failure this file exists for: a stage whose declared
 * pre-condition cannot be satisfied by the artifact the methodology tells the
 * worker to write. The table stays total, the move stays legal, and every real
 * card stops at that stage with "missing required artifact" — a workflow that
 * looks complete in review and deadlocks in production.
 *
 * The sweep chooses its dimensions instead of running all 30 combinations: the
 * review mode is the dimension that REMOVES stages, so every mode is swept on
 * the reference route; the intent is the dimension that RESHAPES the route, so
 * every intent is swept in the mode that removes the most (Auto). The full
 * matrix is available to the experiment loop through `.auto/measure.sh`, which
 * reuses this same driver — a number the loop optimizes has to be the number
 * CI gates.
 */

const REFERENCE_INTENT = "feature";

const SWEEP = [
  { intent: "feature", reviewMode: "Auto" },
  { intent: "bugfix", reviewMode: "Auto" },
  { intent: "refactor", reviewMode: "Auto" },
  { intent: "investigate", reviewMode: "Auto" },
  // The two extremes of the review-mode dimension: one removes two stages
  // (Auto), the other removes none. The middle rungs remove a subset, and
  // `workflow-moves` already runs the helper over every rung at every stage.
  { intent: REFERENCE_INTENT, reviewMode: "Product Spec + Interface + Tech Review + Code Diff" },
  // The stage policies are a fourth input to the route, and a walk with no
  // knobs never reaches them: `production`/3 keeps `context`, so the policy
  // branch of `plannedRoute` would be dead code the sweep calls green.
  { intent: REFERENCE_INTENT, reviewMode: "Auto", quality: "experimental", explorationCount: 1, absent: ["context"] },
];

assert.ok(SWEEP.length >= 6, `the sweep covers both dimensions (${SWEEP.length} walks)`);

// Coverage of the sweep itself. Without this the sweep is a list of examples and
// a seventh intent, or a review mode that removes more stages than Auto, would
// arrive unmeasured while the file stayed green.
const sweptIntents = new Set(SWEEP.map((entry) => entry.intent));
for (const intent of WALK_INTENTS) {
  if (sweptIntents.has(intent)) continue;
  const route = (entry) => JSON.stringify(plannedRoute({ intent: entry.intent, reviewMode: entry.reviewMode }));
  assert.ok(
    SWEEP.some((entry) => route(entry) === JSON.stringify(plannedRoute({ intent, reviewMode: entry.reviewMode }))),
    `${intent} is swept, or walks the same route as a swept intent`,
  );
}
const skippedCount = (mode) => (WORKFLOW_ROUTES.review_modes[mode]?.skipped ?? []).length;
const sweptModes = [...new Set(SWEEP.map((entry) => entry.reviewMode))].filter((mode) => WALK_MODES.includes(mode));
const sweptSkips = sweptModes.map(skippedCount);
assert.equal(
  Math.max(...sweptSkips),
  Math.max(...WALK_MODES.map(skippedCount)),
  "the sweep includes the review mode that removes the most stages",
);
assert.equal(
  Math.min(...sweptSkips),
  Math.min(...WALK_MODES.map(skippedCount)),
  "the sweep includes the review mode that removes the fewest stages",
);

for (const { intent, reviewMode, quality, explorationCount, absent } of SWEEP) {
  const label = `${intent}/${reviewMode}${absent ? ` (policy excludes ${absent.join(",")})` : ""}`;
  const route = plannedRoute({ intent, reviewMode, quality, explorationCount });
  assert.ok(Array.isArray(route) && route.length >= 2, `${label} has a planned route`);
  for (const stage of absent ?? []) {
    assert.ok(!route.includes(stage), `${label}: the planned route drops ${stage}`);
  }
  const walk = walkRoute({ intent, reviewMode, quality, explorationCount });
  assert.equal(
    walk.failure,
    null,
    `${label} walks to audit with only its declared artifacts — blocked at ${JSON.stringify(walk.failure)}`,
  );
  assert.deepEqual(walk.trail, route, `${label} enters exactly the planned stages, in order`);
  for (const stage of absent ?? []) {
    assert.ok(!walk.trail.includes(stage), `${label}: the helper never enters ${stage}`);
  }
  assert.equal(walk.trail.at(-1), "audit", `${label} finishes at the terminal stage`);
}

/**
 * The refusal cells.
 *
 * A refusal without an exit is a deadlock with a good error message, so each
 * cell asserts both halves: the right rule fired, and it named a door. The
 * reject cell is here as the counterweight — a state machine that refused
 * everything would pass every other cell in this list.
 */
const cells = adversarialCells();
assert.ok(cells.length >= 7, `the refusal matrix is present (${cells.length} cells)`);

for (const cell of cells) {
  const result = runCell(cell);
  if (cell.expect.ok) {
    assert.equal(result.ok, true, `"${cell.label}" is allowed: ${result.text}`);
    continue;
  }
  assert.equal(result.ok, false, `"${cell.label}" is refused, not accepted`);
  assert.equal(result.kind, cell.expect.kind, `"${cell.label}" is refused for the right reason: ${result.text}`);
  if (cell.expect.door) {
    assert.deepEqual(result.door, cell.expect.door, `"${cell.label}" names the expected exit: ${result.text}`);
  }
  if (cell.expect.doorEndsWith) {
    assert.ok(
      typeof result.door === "string" && result.door.endsWith(cell.expect.doorEndsWith),
      `"${cell.label}" names the file to fix (${cell.expect.doorEndsWith}): ${result.text}`,
    );
  }
  assert.notEqual(result.door, null, `"${cell.label}" names a way out: ${result.text}`);
}

console.log(`workflow walk ok: ${SWEEP.length} routes passable, ${cells.length} refusal cells name a door`);

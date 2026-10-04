import assert from "node:assert/strict";
import { recipeById } from "../lib/recipe-catalog.mjs";
import {
  activeRecipeTasks,
  applyRouteContext,
  effectiveRecipeWidth,
  hasCoordinatorHumanBoundary,
  runnableRecipeTasks,
} from "../lib/recipe-width.mjs";
import { resolveExecutionRoute } from "../lib/execution-route.mjs";
import { BB_NATIVE_CAPABILITIES } from "../lib/bb-workflow-capabilities.mjs";

const base = (recipe) => ({
  recipe,
  requiredCapabilities: [
    ...(recipe.required_capabilities ?? []),
    ...recipe.tasks.flatMap((task) => task.requirements ?? []),
  ],
  nativeCapabilities: BB_NATIVE_CAPABILITIES,
  nativeAvailable: true,
});

const planning = recipeById("planning-research");
const audit = recipeById("execution-audit");
const verification = recipeById("verification");
const scopeMap = recipeById("scope-map");
const critique = recipeById("plan-critique");
const alternatives = recipeById("interface-alternatives");
const contrast = recipeById("interface-contrast");

// True fan-out survives: two roots plus a join stay width 2.
assert.equal(effectiveRecipeWidth(planning, {}), 2, "planning-research fans out");
assert.equal(effectiveRecipeWidth(audit, {}), 2, "execution-audit fans out");

// Linear chains stay width 1 under any context.
assert.equal(effectiveRecipeWidth(scopeMap, {}), 1, "scope-map is one task");
assert.equal(effectiveRecipeWidth(critique, {}), 1, "plan-critique is a chain");
assert.equal(effectiveRecipeWidth(alternatives, {}), 1, "alternatives is a chain when fanout holds");

// A collapsed fan-out cascades: count 1 skips the root and its dependents.
const collapsed = runnableRecipeTasks(alternatives, { explorationCount: 1 });
assert.deepEqual(
  collapsed.active.map((task) => task.id),
  [],
  "count 1 leaves no runnable alternatives task",
);
assert.equal(effectiveRecipeWidth(alternatives, { explorationCount: 1 }), 0, "collapsed width is zero");
assert.ok(
  activeRecipeTasks(alternatives, {}).length > collapsed.active.length,
  "default context keeps the fanout task",
);

// Conditional UI scope narrows verification from 2 to 1.
assert.equal(effectiveRecipeWidth(verification, { uiScopePresent: true }), 2, "verification fans out with UI scope");
assert.equal(effectiveRecipeWidth(verification, { uiScopePresent: false }), 1, "verification narrows without UI scope");

// Coordinator human boundaries are visible statically.
assert.equal(hasCoordinatorHumanBoundary(contrast, {}), true, "contrast waits on the coordinator");
assert.equal(hasCoordinatorHumanBoundary(planning, {}), false, "planning-research has no human boundary");

// The overlay only ever narrows native to sequential, never the reverse.
const nativeFor = (recipe, context, options) =>
  applyRouteContext(resolveExecutionRoute(base(recipe)), recipe, context, options);

assert.equal(
  nativeFor(planning, {}).mode,
  "native",
  "real fanout stays native",
);
assert.equal(
  nativeFor(alternatives, { explorationCount: 1 }).mode,
  "coordinator-sequential",
  "zero-width work falls back instead of running an empty workflow",
);
assert.equal(
  nativeFor(alternatives, { explorationCount: 1 }).effectiveWidth,
  0,
  "the fallback names its width",
);
assert.equal(
  nativeFor(contrast, {}, { humanBoundaryPolicy: "sequential" }).mode,
  "coordinator-sequential",
  "coordinator waits stay sequential under the sequential policy",
);
assert.equal(
  nativeFor(contrast, {}).mode,
  "native",
  "default policy preserves the current native route",
);
assert.equal(
  nativeFor(scopeMap, {}).mode,
  "native",
  "width 1 is not flipped without live evidence",
);
assert.equal(
  applyRouteContext({ mode: "coordinator-sequential" }, planning, {}).mode,
  "coordinator-sequential",
  "sequential routes pass through untouched",
);

console.log("execution route context test ok: width, cascade, and human-boundary overlay");

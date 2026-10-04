import assert from "node:assert/strict";
import { recipeById } from "../lib/recipe-catalog.mjs";
import { createAdvanceDispatcher } from "../server/execution-advance-dispatch.ts";

const trails = [];
const deps = {
  native: {
    recordCoordinatorSequentialRoute: (cardId, stage, recipeId, route) => {
      trails.push({ cardId, stage, recipeId, route });
    },
  },
  recordExecutionEntry: () => {},
};

const card = { id: "card-check", prompt: "Checklist prompt." };
const scopeMap = recipeById("scope-map");

const { dispatchAdvance } = createAdvanceDispatcher(deps);
const result = await dispatchAdvance({
  card,
  stage: "scope",
  route: {
    recipeId: "scope-map",
    recipe: scopeMap,
    route: { mode: "coordinator-sequential", reason: "test route", preserves: ["artifact"] },
  },
  note: "stage advanced",
  evidence: "test evidence",
});

assert.match(result.stdout, /coordinator-sequential fallback selected/, "the fallback marker stays");
assert.match(result.stdout, /scope-map\.json/, "the worker note names the required artifact");
assert.equal(result.error, null, "checklist never fails the dispatch");
assert.equal(trails.length, 1, "one durable trail");
assert.deepEqual(trails[0].route.requiredOutputs, ["scope-map.json"], "the trail carries required outputs");
assert.equal(trails[0].route.reason, "test route", "the route reason is preserved");

// No recipe (direct-mode advance) keeps the old bare marker.
trails.length = 0;
const bare = await dispatchAdvance({
  card,
  stage: "gate",
  route: { recipeId: "none", recipe: null, route: { mode: "coordinator-sequential", reason: "test" } },
  note: "stage advanced",
  evidence: "test evidence",
});
assert.match(bare.stdout, /coordinator-sequential fallback selected/, "bare marker stays");
assert.doesNotMatch(bare.stdout, /expected outputs/, "no checklist without a recipe");
assert.equal(trails[0].route.requiredOutputs, undefined, "no fabricated outputs on the trail");

console.log("execution dispatch checklist test ok: worker note and trail carry expected outputs");

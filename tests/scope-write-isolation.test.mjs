import assert from "node:assert/strict";
import { checkScopeWrite, isScopeWriteAllowed, resolveExecutionRoute } from "../lib/execution-route.mjs";
import { recipeById } from "../lib/recipe-catalog.mjs";

const held = [{ scopeId: "scope-a", file: "src/a.ts", checkout: "/repo" }];

// Unclaimed writes throw before any mutation lands.
assert.throws(
  () => checkScopeWrite({ scopeId: "scope-b", file: "src/a.ts", checkout: "/repo" }, held),
  /CLAIM_REQUIRED/,
  "a scope without a claim cannot write a held file",
);
assert.throws(
  () => checkScopeWrite({ scopeId: "scope-a", file: "src/other.ts", checkout: "/repo" }, held),
  /CLAIM_REQUIRED/,
  "a claim covers only its files",
);
assert.throws(
  () => checkScopeWrite({ scopeId: "scope-a", file: "src/a.ts", checkout: "/other" }, held),
  /CLAIM_REQUIRED/,
  "a claim covers only its checkout",
);

// The claimed write passes the enforcement point.
assert.equal(checkScopeWrite({ scopeId: "scope-a", file: "src/a.ts", checkout: "/repo" }, held), true, "claimed write passes");
assert.equal(isScopeWriteAllowed({ scopeId: "scope-a", file: "src/a.ts", checkout: "/repo" }, held), true, "predicate agrees on allow");
assert.equal(isScopeWriteAllowed({ scopeId: "scope-b", file: "src/a.ts", checkout: "/repo" }, held), false, "predicate agrees on refuse");

// Mutation guard: removing the enforcement call lets the write land.
// This pin models the call site contract — the write below must stay
// behind the check. If checkScopeWrite ever stops throwing, this fails.
let landed = false;
function guardedWrite(input, claims) {
  checkScopeWrite(input, claims);
  landed = true;
}
assert.throws(() => guardedWrite({ scopeId: "scope-b", file: "src/a.ts", checkout: "/repo" }, held), /CLAIM_REQUIRED/);
assert.equal(landed, false, "unclaimed write never lands (delete the check -> this fails)");

// scope-batch stays coordinator-sequential: no concurrent path.
const scopeBatchRecipe = recipeById("scope-batch");
assert.ok(scopeBatchRecipe, "scope-batch recipe exists");
const route = resolveExecutionRoute({ recipe: scopeBatchRecipe, requiredCapabilities: [], nativeCapabilities: {}, nativeAvailable: true });
assert.equal(route.mode, "coordinator-sequential", "scope-batch never routes to fan-out");

console.log("scope-write-isolation: ok");

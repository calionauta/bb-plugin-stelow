import assert from "node:assert/strict";
import { BB_NATIVE_CAPABILITIES } from "../lib/bb-workflow-capabilities.mjs";
import { EXECUTION_CAPABILITIES } from "../lib/execution-adapter.mjs";
import { resolveExecutionRoute } from "../lib/execution-route.mjs";
import { recipeById } from "../lib/recipe-catalog.mjs";

const recipe = { id: "analysis", write_policy: "artifact", fallback: { mode: "sequential", preserves: ["artifact"] } };
const nativeCapabilities = { pipeline: true, "structured-output": true };
const allNativeCapabilities = Object.fromEntries(EXECUTION_CAPABILITIES.map((capability) => [capability, true]));
const artifactFanoutRecipe = recipeById("interface-alternatives");
const scopeBatchRecipe = recipeById("scope-batch");

assert.ok(artifactFanoutRecipe, "the artifact fanout recipe exists");
assert.ok(scopeBatchRecipe, "the scope-batch recipe exists");
const artifactFanoutCapabilities = [...new Set([
  ...(artifactFanoutRecipe.required_capabilities ?? []),
  ...artifactFanoutRecipe.tasks.flatMap((task) => task.requirements ?? []),
])];
assert.equal(artifactFanoutCapabilities.includes("fanout"), true, "the real artifact recipe requires native fanout");
assert.equal(resolveExecutionRoute({ recipe: artifactFanoutRecipe, requiredCapabilities: artifactFanoutCapabilities, nativeCapabilities: BB_NATIVE_CAPABILITIES, nativeAvailable: true }).mode, "native", "the real artifact fanout recipe runs natively when every required capability is visible");

assert.equal(BB_NATIVE_CAPABILITIES.fanout, true, "BB reports native fanout");
assert.equal(BB_NATIVE_CAPABILITIES["file-claims"], false, "BB does not report file claims");
assert.equal(BB_NATIVE_CAPABILITIES["isolated-workspace"], false, "BB does not report isolated workspaces");
assert.equal(resolveExecutionRoute({ recipe, requiredCapabilities: ["fanout"], nativeCapabilities: BB_NATIVE_CAPABILITIES, nativeAvailable: true }).mode, "native", "artifact recipes may use BB native fanout");
assert.equal(resolveExecutionRoute({ recipe, requiredCapabilities: ["fanout"], nativeCapabilities: allNativeCapabilities, nativeAvailable: true }).mode, "native", "safe artifact recipes can negotiate native fanout");
for (const blocker of ["file-claims", "isolated-workspace"]) {
  const route = resolveExecutionRoute({ recipe, requiredCapabilities: ["fanout", blocker], nativeCapabilities: BB_NATIVE_CAPABILITIES, nativeAvailable: true });
  assert.equal(route.mode, "coordinator-sequential", `${blocker} explicitly blocks native fanout`);
  assert.deepEqual(route.missingCapabilities, [blocker], `${blocker} remains an explicit native blocker`);
}
assert.deepEqual(resolveExecutionRoute({ recipe, requiredCapabilities: ["file-claims", "isolated-workspace"], nativeCapabilities: BB_NATIVE_CAPABILITIES, nativeAvailable: true }).missingCapabilities, ["file-claims", "isolated-workspace"], "both missing safety capabilities are reported");
assert.equal(resolveExecutionRoute({ recipe: { ...recipe, write_policy: "workspace" }, requiredCapabilities: ["fanout"], nativeCapabilities: allNativeCapabilities, nativeAvailable: true }).mode, "coordinator-sequential", "workspace recipes stay sequential even when every capability is claimed");
const scopeBatchRequirements = [...new Set([
  ...(scopeBatchRecipe.required_capabilities ?? []),
  ...scopeBatchRecipe.tasks.flatMap((task) => task.requirements ?? []),
])];
for (const writePolicy of ["workspace", "artifact"]) {
  for (const requiredCapabilities of [[], ["fanout"], scopeBatchRequirements]) {
    for (const nativeAvailable of [true, false]) {
      const route = resolveExecutionRoute({ recipe: { ...scopeBatchRecipe, write_policy: writePolicy }, requiredCapabilities, nativeCapabilities: allNativeCapabilities, nativeAvailable });
      assert.equal(route.mode, "coordinator-sequential", `scope-batch is never native: ${writePolicy}/${requiredCapabilities.join(",") || "none"}/${nativeAvailable}`);
    }
  }
}
assert.equal(resolveExecutionRoute({ recipe: { ...recipe, write_policy: "unknown" }, requiredCapabilities: ["fanout"], nativeCapabilities: BB_NATIVE_CAPABILITIES, nativeAvailable: true }).mode, "coordinator-sequential", "unknown write policy fails closed");
assert.equal(resolveExecutionRoute({ recipe, requiredCapabilities: ["not-a-capability"], nativeCapabilities: { "not-a-capability": true }, nativeAvailable: true }).mode, "coordinator-sequential", "unsupported capability claims fail closed");
assert.deepEqual(resolveExecutionRoute({ recipe, requiredCapabilities: ["not-a-capability"], nativeCapabilities: { "not-a-capability": true }, nativeAvailable: true }).missingCapabilities, ["not-a-capability"], "unsupported claims are reported as missing");
for (const claimedValue of [1, "true", null]) {
  assert.deepEqual(resolveExecutionRoute({ recipe, requiredCapabilities: ["fanout"], nativeCapabilities: { fanout: claimedValue }, nativeAvailable: true }).missingCapabilities, ["fanout"], "only boolean true capability claims are accepted");
}
assert.deepEqual(resolveExecutionRoute({ recipe, requiredCapabilities: ["fanout"], nativeCapabilities: { capabilities: "invalid", fanout: true }, nativeAvailable: true }).missingCapabilities, ["fanout"], "malformed capability containers fail closed");
for (const writePolicy of [undefined, null]) {
  assert.equal(resolveExecutionRoute({ recipe: { ...recipe, write_policy: writePolicy }, requiredCapabilities: ["fanout"], nativeCapabilities: allNativeCapabilities, nativeAvailable: true }).mode, "coordinator-sequential", `missing write policy fails closed: ${writePolicy}`);
}
assert.equal(resolveExecutionRoute({ recipe, requiredCapabilities: ["pipeline"], nativeCapabilities, nativeAvailable: true }).mode, "native");
assert.equal(resolveExecutionRoute({ recipe, requiredCapabilities: ["file-claims"], nativeCapabilities, nativeAvailable: true }).mode, "coordinator-sequential");
assert.equal(resolveExecutionRoute({ recipe, requiredCapabilities: ["pipeline"], nativeCapabilities, nativeAvailable: false }).mode, "coordinator-sequential");
assert.equal(resolveExecutionRoute({ recipe: { ...recipe, fallback: { mode: "refuse", preserves: [] } }, requiredCapabilities: ["file-claims"], nativeCapabilities: BB_NATIVE_CAPABILITIES, nativeAvailable: true }).mode, "refused", "missing capabilities honor an explicit refusal fallback");
assert.equal(resolveExecutionRoute({ recipe: { ...recipe, fallback: { mode: "unknown", preserves: [] } }, requiredCapabilities: [], nativeCapabilities, nativeAvailable: true }).mode, "refused");
assert.equal(resolveExecutionRoute({ recipe: { ...recipe, write_policy: "workspace" }, requiredCapabilities: [], nativeCapabilities, nativeAvailable: true }).mode, "coordinator-sequential");
assert.equal(resolveExecutionRoute({ recipe: { ...recipe, id: "scope-batch" }, requiredCapabilities: [], nativeCapabilities, nativeAvailable: true }).mode, "coordinator-sequential");
assert.equal(resolveExecutionRoute({ recipe: { ...recipe, fallback: undefined }, requiredCapabilities: [], nativeCapabilities, nativeAvailable: true }).mode, "refused");

console.log("execution route test ok: native, coordinator-sequential, and explicit refusal");

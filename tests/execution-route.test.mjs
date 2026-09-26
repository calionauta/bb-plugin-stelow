import assert from "node:assert/strict";
import { BB_NATIVE_CAPABILITIES } from "../lib/bb-workflow-capabilities.mjs";
import { EXECUTION_CAPABILITIES } from "../lib/execution-adapter.mjs";
import {
  NATIVE_SCOPE_BATCH_PILOT_ALLOWED,
  collectScopeBatchPilotReceipts,
  evaluateScopeBatchPilot,
  resolveExecutionRoute,
  verifyScopeBatchPilotReceipt,
} from "../lib/execution-route.mjs";
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

// Scope-batch native pilot: the default recipe route above stays
// coordinator-sequential. Native fan-out is allowed ONLY for disjoint
// scopes with satisfied claims under the pilot flag and proven
// file-claims + isolated-workspace capabilities.
const pilotScopes = [
  { scopeId: "scope-a", targetFiles: ["src/a.ts"] },
  { scopeId: "scope-b", targetFiles: ["src/b.ts"] },
];
const pilotCapabilities = { "file-claims": true, "isolated-workspace": true };

assert.equal(NATIVE_SCOPE_BATCH_PILOT_ALLOWED, false, "the pilot flag ships off: rollback is the default");

{
  const admitted = evaluateScopeBatchPilot({
    scopes: pilotScopes,
    satisfiedScopeIds: ["scope-a", "scope-b"],
    nativeCapabilities: pilotCapabilities,
    nativePilotAllowed: true,
  });
  assert.equal(admitted.mode, "native", "disjoint satisfied-claims batch fans out under bounded concurrency");
  assert.deepEqual(
    admitted.gates,
    { pilot: true, capability: true, admission: true, disjointness: true, concurrency: true },
    "every pilot gate passes on the happy path",
  );
  assert.equal(typeof admitted.timeoutMs, "number", "admitted pilot names its per-scope timeout");
}

for (const failing of [
  {
    name: "flag off rolls back",
    input: {
      scopes: pilotScopes,
      satisfiedScopeIds: ["scope-a", "scope-b"],
      nativeCapabilities: pilotCapabilities,
      nativePilotAllowed: false,
    },
    code: "PILOT_DISABLED",
  },
  {
    name: "missing file-claims capability",
    input: {
      scopes: pilotScopes,
      satisfiedScopeIds: ["scope-a", "scope-b"],
      nativeCapabilities: { "file-claims": false, "isolated-workspace": true },
      nativePilotAllowed: true,
    },
    code: "PILOT_CAPABILITY_GATE",
  },
  {
    name: "missing isolated-workspace capability",
    input: {
      scopes: pilotScopes,
      satisfiedScopeIds: ["scope-a", "scope-b"],
      nativeCapabilities: { "file-claims": true, "isolated-workspace": false },
      nativePilotAllowed: true,
    },
    code: "PILOT_CAPABILITY_GATE",
  },
  {
    name: "overlapping scopes never fan out",
    input: {
      scopes: [
        { scopeId: "scope-a", targetFiles: ["src/shared.ts"] },
        { scopeId: "scope-b", targetFiles: ["src/shared.ts"] },
      ],
      satisfiedScopeIds: ["scope-a", "scope-b"],
      nativeCapabilities: pilotCapabilities,
      nativePilotAllowed: true,
    },
    code: "PARTITION_OVERLAP",
  },
  {
    name: "unsatisfied claim rejects the batch",
    input: {
      scopes: pilotScopes,
      satisfiedScopeIds: ["scope-a"],
      nativeCapabilities: pilotCapabilities,
      nativePilotAllowed: true,
    },
    code: "PILOT_ADMISSION_GATE",
  },
  {
    name: "concurrency bound rejects the batch",
    input: {
      scopes: pilotScopes,
      satisfiedScopeIds: ["scope-a", "scope-b"],
      nativeCapabilities: pilotCapabilities,
      nativePilotAllowed: true,
      maxConcurrency: 1,
    },
    code: "PILOT_CONCURRENCY_BOUND",
  },
]) {
  const route = evaluateScopeBatchPilot(failing.input);
  assert.equal(route.mode, "coordinator-sequential", `pilot gate failure falls back: ${failing.name}`);
  assert.equal(route.code, failing.code, `fallback names its gate: ${failing.name}`);
}

// Live capability report still fails the capability gate: both pilot
// requirements are false, so the default host can never fan out.
{
  const live = evaluateScopeBatchPilot({
    scopes: pilotScopes,
    satisfiedScopeIds: ["scope-a", "scope-b"],
    nativeCapabilities: BB_NATIVE_CAPABILITIES,
    nativePilotAllowed: true,
  });
  assert.equal(live.mode, "coordinator-sequential", "live host capabilities force sequential");
  assert.equal(live.code, "PILOT_CAPABILITY_GATE", "live fallback names the capability gate");
  assert.deepEqual(
    live.missingCapabilities,
    ["file-claims", "isolated-workspace"],
    "live fallback reports both missing safety capabilities",
  );
}

// Receipt gate: claim verification, files touched, and artifact
// manifest are all required before a child is merge-eligible.
{
  const ok = verifyScopeBatchPilotReceipt(
    { scopeId: "scope-a", claimVerified: true, filesTouched: ["src/a.ts"], artifacts: ["a.md"] },
    ["src/a.ts"],
  );
  assert.equal(ok.ok, true, "a complete receipt verifies");
  for (const [name, receipt] of [
    ["unverified claim", { scopeId: "scope-a", claimVerified: false, filesTouched: ["src/a.ts"], artifacts: ["a.md"] }],
    ["no files", { scopeId: "scope-a", claimVerified: true, filesTouched: [], artifacts: ["a.md"] }],
    ["unclaimed file", { scopeId: "scope-a", claimVerified: true, filesTouched: ["src/other.ts"], artifacts: ["a.md"] }],
    ["no artifacts", { scopeId: "scope-a", claimVerified: true, filesTouched: ["src/a.ts"], artifacts: [] }],
  ]) {
    const refused = verifyScopeBatchPilotReceipt(receipt, ["src/a.ts"]);
    assert.equal(refused.ok, false, `receipt gate refuses: ${name}`);
  }
}

// Receipt collection: receipts land per scope and stay disjoint;
// a missing, duplicate, or overlapping receipt refuses the merge.
{
  const complete = collectScopeBatchPilotReceipts(
    [
      { scopeId: "scope-a", claimVerified: true, filesTouched: ["src/a.ts"], artifacts: ["a.md"] },
      { scopeId: "scope-b", claimVerified: true, filesTouched: ["src/b.ts"], artifacts: ["b.md"] },
    ],
    { "scope-a": ["src/a.ts"], "scope-b": ["src/b.ts"] },
  );
  assert.equal(complete.ok, true, "per-scope receipts collect");
  assert.deepEqual(Object.keys(complete.receiptsByScope).sort(), ["scope-a", "scope-b"], "artifacts land per scope");
  const missing = collectScopeBatchPilotReceipts(
    [{ scopeId: "scope-a", claimVerified: true, filesTouched: ["src/a.ts"], artifacts: ["a.md"] }],
    { "scope-a": ["src/a.ts"], "scope-b": ["src/b.ts"] },
  );
  assert.equal(missing.ok, false, "a missing receipt refuses collection");
  assert.equal(missing.code, "RECEIPT_MISSING", "missing receipt names its code");
  const overlapping = collectScopeBatchPilotReceipts(
    [
      { scopeId: "scope-a", claimVerified: true, filesTouched: ["src/a.ts"], artifacts: ["a.md"] },
      { scopeId: "scope-b", claimVerified: true, filesTouched: ["src/a.ts"], artifacts: ["b.md"] },
    ],
    { "scope-a": ["src/a.ts"], "scope-b": ["src/a.ts", "src/b.ts"] },
  );
  assert.equal(overlapping.ok, false, "overlapping writes refuse collection");
  assert.equal(overlapping.code, "RECEIPT_WRITE_OVERLAP", "write overlap names its code");
}

console.log("execution route test ok: native, coordinator-sequential, and explicit refusal");

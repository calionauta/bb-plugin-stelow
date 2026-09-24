import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ExecutionAdapter, assertCapabilities, missingCapabilities, normalizeRun } from "../lib/execution-adapter.mjs";
import { BB_NATIVE_CAPABILITIES, missingNativeCapabilities } from "../lib/bb-workflow-capabilities.mjs";
import { createBbWorkflowAdapter } from "../server/bb-workflow-adapter.ts";
import { renderInlineWorkflowScript } from "../server/bb-workflow-bridge.ts";

const report = { capabilities: { pipeline: true, "structured-output": true } };
const recipe = { required_capabilities: ["pipeline", "structured-output"] };
let runCalls = 0;
const native = new ExecutionAdapter({
  name: "native",
  capabilities: () => report,
  run: async () => {
    runCalls += 1;
    return { status: "running" };
  },
  status: async () => ({ status: "done" }),
  resume: async () => ({ status: "queued" }),
  cancel: async () => ({ status: "canceled" }),
  result: async () => ({ status: "succeeded" }),
});
assert.equal(BB_NATIVE_CAPABILITIES.fanout, true, "BB exposes native fanout");
assert.equal(BB_NATIVE_CAPABILITIES["file-claims"], false, "BB does not claim file-claim support");
assert.equal(BB_NATIVE_CAPABILITIES["isolated-workspace"], false, "BB does not claim isolated workspaces");
const schema = { $schema: "https://json-schema.org/draft/2020-12/schema", type: "object", required: ["content"], properties: { content: { type: "string" } }, additionalProperties: false };
const renderedSource = renderInlineWorkflowScript({ id: "schema-probe", tasks: [{ id: "task", output_schema_contract: schema }] }, { localRunId: "exec_test" });
assert.doesNotMatch(renderedSource, /"\$schema":/, "rendered recipe schemas are accepted by the safe workflow subset");
assert.match(renderedSource, /artifactRoot \+ '\/' \+ task\.output/, "rendered agent prompts keep their output-path instruction valid");
assert.deepEqual(
  missingNativeCapabilities(["fanout", "file-claims", "isolated-workspace"]),
  ["file-claims", "isolated-workspace"],
  "the production preflight exposes both native workspace blockers",
);
assert.deepEqual(missingCapabilities(recipe.required_capabilities, report.capabilities), []);
assert.deepEqual(missingCapabilities(["not-a-capability"], { "not-a-capability": true }), ["not-a-capability"], "unknown capability claims are not accepted");
for (const claimedValue of [1, "true", null]) {
  assert.deepEqual(missingCapabilities(["fanout"], { capabilities: { fanout: claimedValue } }), ["fanout"], "only boolean true claims are accepted");
}
assert.deepEqual(missingCapabilities(["fanout"], { capabilities: "invalid", fanout: true }), ["fanout"], "malformed capability containers fail closed");
assert.deepEqual(missingCapabilities(["fanout"], ["fanout"]), ["fanout"], "array capability containers fail closed");
assert.throws(() => assertCapabilities(["not-a-capability"], { capabilities: { "not-a-capability": true } }), /missing capabilities: not-a-capability/);
assert.throws(() => assertCapabilities(["file-claims"], BB_NATIVE_CAPABILITIES), /missing capabilities: file-claims/);
await assert.rejects(() => native.run({ required_capabilities: ["file-claims"] }, {}), /missing capabilities: file-claims/);
assert.equal(runCalls, 0, "a capability refusal happens before agent execution");

const nativeRuns = [];
const bbNative = createBbWorkflowAdapter({
  run: async ({ recipe: selected }) => {
    nativeRuns.push(selected.id);
    return { status: "running" };
  },
  status: async () => ({ status: "done" }),
  resume: async () => ({ status: "queued" }),
  cancel: async () => ({ status: "canceled" }),
  result: async () => ({ status: "succeeded" }),
});
assert.equal(bbNative.capabilities().capabilities.fanout, true, "the concrete BB adapter exposes fanout");
await bbNative.run({ id: "safe-artifact", write_policy: "artifact", required_capabilities: ["fanout"] }, {});
for (const blocker of ["file-claims", "isolated-workspace"]) {
  await assert.rejects(() => bbNative.run({ id: "blocked-artifact", write_policy: "artifact", required_capabilities: ["fanout", blocker] }, {}), new RegExp(`missing capabilities: ${blocker}`), `${blocker} blocks the concrete BB adapter`);
}
for (const { recipe: unsafeRecipe, error } of [
  {
    recipe: { id: "workspace-recipe", write_policy: "workspace", required_capabilities: ["fanout"] },
    error: /workspace-writing recipes.*file claims.*sequential/i,
  },
  {
    recipe: { id: "scope-batch", write_policy: "artifact", required_capabilities: ["fanout"] },
    error: /scope-batch.*native fan-out is disabled/i,
  },
]) {
  await assert.rejects(() => bbNative.run(unsafeRecipe, {}), error, `${unsafeRecipe.id} is refused before native execution`);
}
assert.deepEqual(nativeRuns, ["safe-artifact"], "only the safe artifact recipe reaches the native workflow tool");

assert.deepEqual(await native.run(recipe, {}), { state: "running", status: "running" });
assert.deepEqual(await native.status({}), { state: "succeeded", status: "done" });
assert.deepEqual(await native.resume({}, { required_capabilities: ["pipeline"] }), { state: "queued", status: "queued" });
assert.deepEqual(await native.result({}), { state: "succeeded", status: "succeeded" });
assert.deepEqual(await native.cancel({}), { state: "cancelled", status: "canceled" });
assert.deepEqual(normalizeRun({ status: "needs input" }), { state: "needs_input", status: "needs input" });
assert.throws(() => assertCapabilities(["resume"], report), /missing capabilities: resume/);

const root = fileURLToPath(new URL("..", import.meta.url));
const nativeSource = readFileSync(join(root, "server", "execution-native.ts"), "utf8");
const lifecycleSource = readFileSync(join(root, "server", "execution-lifecycle.ts"), "utf8");
const reconcileSource = readFileSync(join(root, "server", "execution-reconcile.ts"), "utf8");
assert.match(nativeSource, /adapterFor\(run\)\.run\(/, "native launch uses adapter.run()");
assert.match(reconcileSource, /native\.adapterFor\(run\)\.status\(/, "reconciliation uses adapter.status()");
assert.match(lifecycleSource, /native\.adapterFor\(run\)\.resume\(/, "boundary answers use adapter.resume()");
assert.match(lifecycleSource, /native\.adapterFor\(run\)\.cancel\(/, "owned-run cancellation uses adapter.cancel()");

console.log("execution adapter test ok: capabilities, normalization, explicit refusal, production wiring");

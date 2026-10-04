import assert from "node:assert/strict";
import { renderInlineWorkflowScript, scriptOutcome } from "../server/bb-workflow-bridge.ts";

// Context: the host read only the WORKFLOW's status. A recipe script that
// finished without doing its work still completed the workflow, so BB said
// "succeeded" and the run surfaced three layers down as a missing artifact.
// The script's own answer was never read. On the real scope-map run the
// script returned `{state: "succeeded", outputs: {}}` — zero work, zero
// agents, reported as a pass.
const run = (result, extra = {}) => ({ runId: "wfr-1", status: "succeeded", ...extra, result });

// A recipe that produced nothing is a failure, not a success. This is the
// case that shipped: drop the empty-outputs branch and the run reads as a pass.
const empty = scriptOutcome(run({ state: "succeeded", recipe: "scope-map", outputs: {} }));
assert.equal(empty.status, "failed", "a recipe that produced no outputs is not a successful run");
assert.match(empty.scriptError, /no task outputs/, "the failure says the recipe did nothing, not that a file is missing");

// A script that reported its own failure keeps its reason, so the card can
// show the cause instead of a downstream artifact miss.
const failed = scriptOutcome(run({ state: "failed", error: "missing execution identity" }));
assert.equal(failed.status, "failed", "a script-level failure is a failed run");
assert.equal(failed.scriptError, "missing execution identity", "the script's own reason survives to the card");

const errored = scriptOutcome(run({ state: "error" }));
assert.equal(errored.status, "failed", "an errored script is a failed run");
assert.match(errored.scriptError, /reported a failure/, "an errored script with no reason still names something honest");

// A recipe that did its work passes through untouched.
const worked = scriptOutcome(run({ state: "succeeded", recipe: "plan-critique", outputs: { "critique-review": { findings: [] } } }));
assert.equal(worked.status, "succeeded", "a recipe with outputs is untouched");
assert.equal(worked.scriptError, undefined, "a passing run carries no error");

// needs_input is a real outcome, not a failure: the script stopping to ask is
// the whole point of the boundary contract.
const asked = scriptOutcome(run({ state: "needs_input", recipe: "interface-contrast", question: "Which placement?" }));
assert.notEqual(asked.status, "failed", "a script asking a question is never rewritten into a failure");
assert.equal(asked.scriptState, undefined, "a non-failing outcome adds no error");

// An outcome the host cannot read must not be turned into a failure. Inventing
// one would park healthy cards on a host hiccup.
for (const [label, value] of [
  ["no result key", { runId: "wfr-1", status: "succeeded" }],
  ["null result", run(null)],
  ["array result", run([{ state: "succeeded" }])],
  ["result without state", run({ outputs: {} })],
  ["non-object run", "succeeded"],
  ["null run", null],
]) {
  const out = scriptOutcome(value);
  assert.notEqual(out?.status, "failed", `${label} is never rewritten into a failure`);
}

// The unread case, pinned by identity: a run with no result comes back
// untouched, not a rewritten object. Invent a failure here and healthy cards
// park on a host hiccup.
const untouched = { runId: "wfr-2", status: "succeeded" };
assert.equal(scriptOutcome(untouched), untouched, "a run with no result is returned as-is, not rebuilt");
assert.equal(scriptOutcome("succeeded"), "succeeded", "a non-object run is returned as-is");

// A task that "produced" null produced no evidence: a swallowed host call
// resolves nullish. Null-valued outputs fail; anything else present passes.
const nulled = scriptOutcome(run({ state: "succeeded", recipe: "scope-map", outputs: { "scope-map": null } }));
assert.equal(nulled.status, "failed", "a null task output is not a successful run");
assert.match(nulled.scriptError, /no task outputs/);

// Boundary pins, not gaps: only all-null fails. A batch where one task has
// real evidence passes (per-task artifact validation owns the missing
// piece), and unrecognized shapes never invent a failure.
const partial = scriptOutcome(run({ state: "succeeded", recipe: "r", outputs: { a: null, b: { findings: [] } } }));
assert.equal(partial.status, "succeeded", "one real output carries the batch");
for (const [label, outputs] of [["null", null], ["missing", undefined], ["array", []], ["scalar", "done"]]) {
  const out = scriptOutcome(run({ state: "succeeded", recipe: "r", outputs }));
  assert.notEqual(out.status, "failed", `${label} outputs are unrecognized, not empty — no invented failure`);
}
for (const [label, value] of [["zero", 0], ["false", false], ["empty string", ""], ["empty object", {}], ["skip record", { skipped: true }]]) {
  const out = scriptOutcome(run({ state: "succeeded", recipe: "r", outputs: { t: value } }));
  assert.notEqual(out.status, "failed", `${label} is a present value, not missing evidence`);
}

// The engine rejects `pattern` in agent schemas outright (safe-subset guard
// against catastrophic backtracking), so the renderer strips it at the
// engine boundary. Local artifact validation keeps the full contract — only
// the dispatched copy is sanitized. This is the exact shape that no-op'd
// card_a9q5zhzd twice: scope-map's mapId pattern killed the call in 76ms
// with zero agent dispatches.
const patterned = renderInlineWorkflowScript(
  {
    id: "scope-map",
    tasks: [{
      id: "scope-map",
      output_schema_contract: {
        type: "object",
        properties: { mapId: { type: "string", pattern: "^[A-Za-z0-9_.-]{1,80}$" } },
      },
    }],
  },
  {},
);
assert.doesNotMatch(patterned, /"pattern"/, "the dispatched schema carries no regular expressions");
assert.match(patterned, /"mapId"/, "while the constrained field itself survives");

// A property literally NAMED pattern is a field, not the keyword: its value
// is an object, not a regex, and position plus value type tell them apart.
const fieldNamed = renderInlineWorkflowScript(
  {
    id: "field-probe",
    tasks: [{
      id: "t",
      output_schema_contract: {
        type: "object",
        properties: { pattern: { type: "string", description: "a sewing pattern name" } },
      },
    }],
  },
  {},
);
assert.match(fieldNamed, /"pattern":\{"type":"string"/, "a field named pattern survives with its shape");

// The template refuses a swallowed call loudly instead of succeeding empty.
// String presence is not behavior, so this executes the rendered loop with
// stubbed host calls: parallel resolving undefined with no outputs entry
// must throw naming the task; a condition-skipped task (outputs entry
// written, undefined returned) must complete quietly with its skip record.
async function runRendered(recipe, { agentImpl, context = {} }) {
  const source = renderInlineWorkflowScript(recipe, { localRunId: "exec_probe", ...context });
  const body = source.replace(/^export const meta = .*$/m, "");
  const run = new Function("agent", "parallel", "args", `return (async () => {${body}})();`);
  const parallel = async (thunks) => {
    const out = [];
    for (const thunk of thunks) out.push(await thunk());
    return out;
  };
  return run(agentImpl, parallel, { localRunId: "exec_probe", recipeId: recipe.id, ...context });
}

const stubTask = (overrides = {}) => ({
  id: "t1",
  output: "t1.json",
  depends_on: [],
  when: "always",
  requirements: [],
  failure_policy: "fail",
  human_boundary: "none",
  output_schema_contract: { type: "object" },
  ...overrides,
});

await assert.rejects(
  runRendered({ id: "r", tasks: [stubTask()] }, { agentImpl: async () => undefined }),
  /Task produced no result: t1/,
  "a swallowed host call throws naming the task instead of succeeding empty",
);

let dispatched = 0;
const skipped = await runRendered(
  { id: "r", tasks: [stubTask({ when: "partition_is_safe" })] },
  {
    agentImpl: async () => { dispatched += 1; return { evidence: true }; },
    context: { context: {} },
  },
);
assert.equal(dispatched, 0, "a condition-skipped task never dispatches");
assert.deepEqual(
  skipped.outputs,
  { t1: { skipped: true, reason: "condition-false" } },
  "and completes quietly carrying its skip record",
);

console.log("script outcome test ok: the script's own answer decides, an unread outcome is never invented");

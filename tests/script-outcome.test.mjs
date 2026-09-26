import assert from "node:assert/strict";
import { scriptOutcome } from "../server/bb-workflow-bridge.ts";

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

console.log("script outcome test ok: the script's own answer decides, an unread outcome is never invented");

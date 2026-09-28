import assert from "node:assert/strict";
import { humanStopRequest, humanStopMessage } from "../lib/execution-human-stop.mjs";

// The receipt the live run actually produced: a deliberate stop naming a
// decision. Before this rule it was recorded as `failed` /
// `artifact-malformed` and the card sat in "Working" with the question
// nowhere on screen.
//
// It carries no `staleArtifacts`: the contrast schema sets
// `additionalProperties: false` and never declares the field, so a real
// receipt cannot name its own stale set. The fixture used to carry one and
// the assertion below used to echo it back — a test that passed on a
// document the schema forbids.
const stopReceipt = {
  schemaVersion: 1,
  receiptId: "contrast-exec_tu34f4ua",
  route: "stop-and-name-decision",
  briefStatus: "stop",
  authority: "human",
  disposition: "human-decision-required",
  decisionQuestion: "Should the read-only Scope Map view extend the existing Scope stage surface, or become a separate user-visible concept?",
};

const stop = humanStopRequest("interfaces/contrast.json", stopReceipt);
assert.equal(stop.stop, true, "a named human decision is a stop, not a failure");
assert.equal(
  stop.question,
  "Should the read-only Scope Map view extend the existing Scope stage surface, or become a separate user-visible concept?",
  "the question travels verbatim — the worker chose these words on purpose",
);
assert.deepEqual(
  stop.staleArtifacts,
  ["scope-map", "interface-contrasts", "selection", "technical-plan"],
  "the stale set is derived from the route table, the only authority for it",
);

// The regression this closes: a receipt smuggling its own stale set is
// ignored, so the card cannot be told one thing by the artifact and another
// by the route it claims to take.
const smuggled = humanStopRequest("interfaces/contrast.json", {
  ...stopReceipt,
  staleArtifacts: ["scope-map", "selection"],
});
assert.deepEqual(
  smuggled.staleArtifacts,
  stop.staleArtifacts,
  "a declared staleArtifacts field cannot narrow or widen the route's list",
);

// Fail-closed on a brief that is not stopped: the route table admits only
// `stop:human-decision-required`, so a generation-ready brief naming a
// human decision is an inconsistent receipt, not a stop.
for (const [label, mutation] of [
  ["authority agent", { authority: "agent" }],
  ["disposition continue", { disposition: "continue" }],
  ["brief still generating", { briefStatus: "generation-ready" }],
  ["empty question", { decisionQuestion: "   " }],
  ["missing question", { decisionQuestion: undefined }],
  ["unrelated route", { route: "interface-refinement" }],
]) {
  const receipt = { ...stopReceipt, ...mutation };
  assert.equal(
    humanStopRequest("interfaces/contrast.json", receipt).stop,
    false,
    `${label} is not treated as a human stop`,
  );
}

// The wording must let a human tell "asking me" from "broke" without opening
// the trail. Remove the "did not fail" framing and the distinction is lost.
const message = humanStopMessage(stop);
assert.match(message, /did not fail/, "the card says this is a question, not a failure");
assert.match(message, /Should the read-only Scope Map view/, "the card quotes the actual question");
assert.match(message, /stays paused until you answer/, "the card says the run is waiting, not silently stalled");

for (const [label, value] of [
  ["null", null],
  ["a string", "stop"],
  ["an array", []],
  ["a number", 3],
]) {
  assert.equal(humanStopRequest("interfaces/contrast.json", value).stop, false, `${label} receipt never reads as a stop`);
}

assert.equal(humanStopRequest("interfaces/selection-receipt.json", stopReceipt).stop, false, "only the contrast receipt carries a stop");
assert.equal(humanStopRequest("scope-map.json", stopReceipt).stop, false, "a scope map never carries a stop");

console.log("execution human stop test ok: a named decision is a stop, a broken run still fails");

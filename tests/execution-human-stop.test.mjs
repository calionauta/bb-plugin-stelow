import assert from "node:assert/strict";
import { humanStopRequest, humanStopMessage } from "../lib/execution-human-stop.mjs";

// The receipt the live run actually produced: a deliberate stop naming a
// decision. Before this rule it was recorded as `failed` /
// `artifact-malformed` and the card sat in "Working" with the question
// nowhere on screen.
const stopReceipt = {
  schemaVersion: 1,
  receiptId: "contrast-exec_tu34f4ua",
  route: "stop-and-name-decision",
  briefStatus: "stop",
  authority: "human",
  disposition: "human-decision-required",
  decisionQuestion: "Should the read-only Scope Map view extend the existing Scope stage surface, or become a separate user-visible concept?",
  staleArtifacts: ["scope-map", "selection"],
};

const stop = humanStopRequest("interfaces/contrast.json", stopReceipt);
assert.equal(stop.stop, true, "a named human decision is a stop, not a failure");
assert.equal(
  stop.question,
  "Should the read-only Scope Map view extend the existing Scope stage surface, or become a separate user-visible concept?",
  "the question travels verbatim — the worker chose these words on purpose",
);
assert.deepEqual(stop.staleArtifacts, ["scope-map", "selection"], "the stale artifacts the route declared are carried through");

// The wording must let a human tell "asking me" from "broke" without opening
// the trail. Remove the "did not fail" framing and the distinction is lost.
const message = humanStopMessage(stop);
assert.match(message, /did not fail/, "the card says this is a question, not a failure");
assert.match(message, /Should the read-only Scope Map view/, "the card quotes the actual question");
assert.match(message, /stays paused until you answer/, "the card says the run is waiting, not silently stalled");

// Fail-closed: a broken run must never be mistaken for a deliberate stop, or
// the card would park forever waiting for a question nobody will see.
for (const [label, mutation] of [
  ["authority agent", { authority: "agent" }],
  ["disposition continue", { disposition: "continue" }],
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

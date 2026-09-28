import assert from "node:assert/strict";
import { liveProgressNote } from "../lib/execution-run-presentation.mjs";

// The regression this closes: an active run showed a state label and nothing
// else, so the card read as a spinner with nowhere to look. The ledger holds
// the native run's previewDirective, but that is a chat token — rendering it
// raw on a card shows a machine string that does nothing when clicked.
assert.equal(
  liveProgressNote("running"),
  "Live step progress streams in the card's thread.",
  "a running run says where the progress is",
);
assert.equal(liveProgressNote("queued"), "Live step progress streams in the card's thread.", "a queued run has not started, and still has somewhere to look");

// A paused run's progress is the question already on the card, and a finished
// run has none. Both must get nothing rather than a stale pointer at a thread
// that is no longer moving.
assert.equal(liveProgressNote("needs_input"), null, "a run waiting on a person is not streaming — its question is the card's job");
for (const status of ["succeeded", "failed", "cancelled"]) {
  assert.equal(liveProgressNote(status), null, `a ${status} run has no live progress to point at`);
}
assert.equal(liveProgressNote(undefined), null, "an unknown state claims nothing");

console.log("execution run presentation test ok: a moving run names where its progress is, a stopped one does not");

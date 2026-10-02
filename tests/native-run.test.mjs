import assert from "node:assert/strict";
import test from "node:test";
import { keepsCardRunning, liveRun, runSentence } from "../lib/native-run.mjs";

/**
 * The rule that was written and never called.
 *
 * `keepsCardRunning` used to live in `server/execution-lifecycle-start.ts` and
 * was exported through the lifecycle facade. Nothing invoked it, so the 45s
 * sync read an idle coordinator thread, found no pending question, and took the
 * idle branch on cards that were mid-workflow. Observed on card_cbnihg4c
 * (2026-09-30): the `planning-research` run was `running` while the thread was
 * idle, and the card was nudged, spent auto-continue budget, and parked as
 * "Idle with unfinished work" behind a Resume button for work already in
 * flight.
 */

const run = (overrides = {}) => ({
  id: "exec_1",
  normalizedStatus: "running",
  recipeId: "planning-research",
  stage: "planning",
  stageLabel: "Tech planning",
  ...overrides,
});

test("a running run keeps the card running", () => {
  assert.equal(keepsCardRunning([run()], 0), true);
});

test("a queued run keeps the card running", () => {
  assert.equal(keepsCardRunning([run({ normalizedStatus: "queued" })], 0), true);
});

test("a finished run does not keep the card running", () => {
  // The regression this whole change exists to prevent, stated as a rule: the
  // run that failed and left is history, and a card must be free to park.
  for (const status of ["succeeded", "failed", "cancelled"]) {
    assert.equal(keepsCardRunning([run({ normalizedStatus: status })], 0), false, status);
  }
});

test("a run waiting on a boundary yields to an open question", () => {
  // A card with an open question is a card the user is already in. The
  // question is the thing to show, so the run must not paper over it.
  assert.equal(keepsCardRunning([run({ normalizedStatus: "needs_input" })], 1), false);
  assert.equal(keepsCardRunning([run({ normalizedStatus: "needs_input" })], 0), true);
});

test("the newest live run is the one that speaks", () => {
  // BOTH runs are live. The previous version made the second one terminal, so it
  // was filtered out before `live[0]` and `live[live.length - 1]` could ever
  // disagree — the test named the ordering and never exercised it, and inverting
  // the index passed. A live run behind a live run is the only case that can
  // tell them apart, so that is the case this uses.
  const runs = [run(), run({ id: "exec_0", recipeId: "older" })];
  assert.equal(liveRun(runs).id, "exec_1", "the first of two live runs is the one that speaks");
  assert.equal(keepsCardRunning(runs, 0), true);
});

test("a finished run is never the live one, however recent", () => {
  // The state set itself, which the outcome tests above could not pin: a
  // `succeeded` or `cancelled` run added to LIVE_STATES passed every other
  // assertion here, because the branches downstream happened to mask it. Only a
  // test that asks `liveRun` DIRECTLY about a finished run closes that.
  for (const normalizedStatus of ["succeeded", "failed", "cancelled"]) {
    assert.equal(liveRun([run({ normalizedStatus })]), null, normalizedStatus);
  }
  assert.equal(liveRun([run({ normalizedStatus: "needs_input" })])?.id, "exec_1");
  assert.equal(liveRun([run({ normalizedStatus: "queued" })])?.id, "exec_1");
});

test("no runs means nothing keeps the card running", () => {
  assert.equal(liveRun([]), null);
  assert.equal(keepsCardRunning([], 0), false);
  assert.equal(keepsCardRunning(null, 0), false);
});

test("every sentence says the work continues on its own", () => {
  // The affordance contract, shared with lib/host-hold.mjs: work the system is
  // already doing gets no button and no inbox row. A sentence containing
  // "resume", "retry" or "start" would put a human between a run that is
  // already progressing.
  for (const status of ["queued", "running", "needs_input"]) {
    const sentence = runSentence(run({ normalizedStatus: status }));
    assert.ok(sentence, `${status} has a sentence`);
    assert.match(sentence, /no action needed/i, `${status} promises no work for the reader`);
    for (const verb of ["resume", "retry", "restart", "start it"]) {
      assert.ok(!new RegExp(verb, "i").test(sentence), `${status} must not ask the reader to ${verb}`);
    }
  }
});

test("the sentence names the stage the card already uses", () => {
  // The card said "Tech planning" and the run said "planning-research", and
  // nothing connected them. The stage label is the word the rest of the card
  // is written in, so it leads and the recipe slug is not needed to read it.
  const sentence = runSentence(run());
  assert.match(sentence, /Tech planning/);
  assert.ok(!/planning-research/.test(sentence), "the host's slug is not the reader's vocabulary");
});

test("a run with no usable name still reads as a sentence", () => {
  // Defensive, not decorative: a run whose stage the catalog does not name must
  // not render an empty label, and must never fall through to a blank.
  const sentence = runSentence(run({ stage: "", stageLabel: null, recipeId: "scope-map" }));
  assert.match(sentence, /scope-map/);
  assert.equal(runSentence(null), null);
});

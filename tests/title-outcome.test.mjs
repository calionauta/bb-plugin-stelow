/**
 * Title-outcome taxonomy and the record the title path leaves.
 *
 * Its own file on purpose: tests/server-drafting.test.mjs's `harness` sits at
 * exactly its recorded debt ceiling (83 lines, scripts/source-debt.json) and
 * debt-baseline.test.mjs forbids growing it. New behaviour gets a new fixture.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  TITLE_OUTCOMES,
  classifyTitleOutcome,
  isRecordable,
  isRetryable,
  titleOutcomeComment,
} from "../lib/title-outcome.mjs";

const live = (title) => ({ title });
const settled = { status: "idle", timedOut: false };

test("the taxonomy is closed: exactly the eleven approved values", () => {
  assert.equal(TITLE_OUTCOMES.length, 11);
  assert.deepEqual([...TITLE_OUTCOMES].sort(), [
    "archived_mid_burst",
    "card_gone",
    "delivered",
    "delivered_after_retry",
    "internal_error",
    "invalid_output",
    "no_output",
    "renamed_mid_burst",
    "spawn_failed",
    "thread_error",
    "timed_out",
  ]);
});

test("every outcome is reachable by construction", () => {
  const reached = new Set();
  const cases = [
    { spawned: true, completion: settled, output: "A title", validated: { ok: true, name: "A title" }, live: live("old") },
    { spawned: false, live: live("old") },
    { spawned: true, completion: settled, output: "", validated: null, live: live("old") },
    { spawned: true, completion: settled, output: "junk", validated: { ok: false, name: null }, live: live("old") },
    { spawned: true, completion: { status: "idle", timedOut: true }, output: "", validated: null, live: live("old") },
    { spawned: true, completion: { status: "error", timedOut: false }, output: "", validated: null, live: live("old") },
    { spawned: true, completion: settled, output: "A title", validated: { ok: true, name: "A title" }, live: live("Human chose this"), originalTitle: "old" },
    // A rename that lands while the burst is ALSO timing out must still read as
    // a rename: the rename check precedes the completion check.
    { spawned: true, completion: { status: "idle", timedOut: true }, output: "", validated: null, live: live("Human chose this"), originalTitle: "old" },
    { spawned: true, completion: settled, output: "A title", validated: { ok: true, name: "A title" }, live: live("old"), archived: true },
    { spawned: true, completion: settled, output: "A title", validated: { ok: true, name: "A title" }, live: null },
    { threw: true },
  ];
  for (const input of cases) reached.add(classifyTitleOutcome(input));
  // delivered_after_retry is produced by the caller, not the classifier.
  reached.add("delivered_after_retry");
  assert.equal(reached.size, TITLE_OUTCOMES.length, `unreached: ${TITLE_OUTCOMES.filter((o) => !reached.has(o)).join(", ")}`);
});

test("status beats budget: an error on the FINAL poll is thread_error, not timed_out", () => {
  // waitForThread returns timedOut: poll === polls - 1, so an errored final
  // poll sets timedOut too. Checking the flag first would fire the retry on a
  // thread that errored.
  const outcome = classifyTitleOutcome({
    spawned: true,
    completion: { status: "error", timedOut: true },
    output: "",
    validated: null,
    live: live("old"),
  });
  assert.equal(outcome, "thread_error");
  assert.equal(isRetryable(outcome), false, "an errored thread must never trigger the retry");
});

test("only a timeout is retryable", () => {
  assert.equal(isRetryable("timed_out"), true);
  for (const outcome of TITLE_OUTCOMES.filter((o) => o !== "timed_out")) {
    assert.equal(isRetryable(outcome), false, `${outcome} must not retry`);
  }
});

test("no_output is classified before invalid_output, so it stays reachable", () => {
  const outcome = classifyTitleOutcome({
    spawned: true,
    completion: settled,
    output: "",
    validated: { ok: false, name: null },
    live: live("old"),
  });
  assert.equal(outcome, "no_output");
});

test("card_gone, renamed_mid_burst and archived_mid_burst leave no comment", () => {
  for (const outcome of ["card_gone", "renamed_mid_burst", "archived_mid_burst"]) {
    assert.equal(isRecordable(outcome), false, `${outcome} must not be recordable`);
    assert.equal(titleOutcomeComment(outcome, { presetName: "P" }), null);
  }
});

test("a recordable outcome names cause, preset, retry state and next move", () => {
  const body = titleOutcomeComment("timed_out", { presetName: "Fast", presetSource: "band", retried: true });
  assert.match(body, /timed out/, "names the cause");
  assert.match(body, /Fast \(generation preset unset\)/, "names the preset that ran and why it was the fallback");
  assert.match(body, /after one retry/, "names the retry state");
  assert.match(body, /Rename inline/, "names the next move");
});

test("a board preset reads differently from a band fallback", () => {
  const board = titleOutcomeComment("timed_out", { presetName: "Cheap", presetSource: "board" });
  assert.match(board, /the Cheap preset/);
  assert.doesNotMatch(board, /generation preset unset/);
});

test("delivered_after_retry is recorded so a working retry cannot erase the tally", () => {
  const body = titleOutcomeComment("delivered_after_retry", { presetName: "P", presetSource: "band" });
  assert.ok(body, "a retry that worked still leaves a countable record");
  assert.match(body, /timed out on the first attempt/);
});

test("an unknown outcome produces no comment rather than a throw", () => {
  assert.equal(isRecordable("not_a_real_outcome"), false);
  assert.equal(titleOutcomeComment("not_a_real_outcome", {}), null);
});

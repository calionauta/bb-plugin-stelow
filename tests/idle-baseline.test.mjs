/**
 * A card-detail read must not decide whether the worker is nudged.
 *
 * `readCardDetail` calls `syncThreadState` before it answers, and that sync
 * projects the running thread — which writes `last_assistant_text`. The resume
 * rule used to compare the finished turn's text against that same field, so a
 * turn whose final words had been sampled by a reader mid-turn read as "no new
 * output": the worker was parked as a silent stop instead of being nudged,
 * because somebody looked at the card. Whether a card resumes must be a fact
 * about the card, not about the reader.
 *
 * The baseline is `last_idle_text`, written only where the card parks or
 * resumes. These cases hold the turn's words fixed and vary only how often the
 * running projection sampled them.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { projectNoProgress, projectRunningState } from "../server/runtime/thread-state-projection.ts";
import { card } from "./helpers/build-thread-sync-harness.mjs";

/** What a reader's sync writes while the turn is still running. */
function afterARead(row, words) {
  return { ...row, ...projectRunningState(row, "shape", words, []) };
}

test("the running projection writes the live text, as the reader-triggered sync does", () => {
  const written = projectRunningState(card({ last_idle_text: "the previous stop" }), "shape", "this turn's words", []);
  assert.equal(written.last_assistant_text, "this turn's words", "the running sync records the live text");
  assert.equal(
    Object.hasOwn(written, "last_idle_text"),
    false,
    "and leaves the idle baseline alone — that is the whole point",
  );
});

test("a read mid-turn does not make the turn's own words look stale", () => {
  const base = card({ status: "in-progress", stage: "shape", activity: "running", last_idle_text: "the previous stop" });
  const sampled = afterARead(base, "this turn's words");
  assert.equal(
    projectNoProgress(sampled, true, "this turn's words"),
    false,
    "new words since the last idle edge are progress, however many reads saw them first",
  );
});

test("a second stop on the same words is still not progress", () => {
  const base = card({ status: "in-progress", stage: "shape", activity: "running", last_idle_text: "the same words" });
  assert.equal(
    projectNoProgress(afterARead(base, "the same words"), true, "the same words"),
    true,
    "the baseline is the previous idle edge, so stopping twice on one sentence stays a silent stop",
  );
});

test("a first stop has no baseline to match, so it counts as progress", () => {
  const base = card({ status: "in-progress", stage: "shape", activity: "running", last_idle_text: null });
  assert.equal(
    projectNoProgress(afterARead(base, "first words"), true, "first words"),
    false,
    "with no recorded stop there is nothing to be identical to",
  );
});

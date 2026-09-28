import assert from "node:assert/strict";
import test from "node:test";
import {
  cardBlocker,
  cardSummary,
  deliverableCount,
  runTally,
  scopeTally,
} from "../lib/card-summary.mjs";

const label = (stage) => `Stage:${stage}`;

// What still needs a person outranks everything else. A card waiting on a
// decision is a different card from one that quietly finished, and the
// summary has to lead with whichever it is rather than with a tally.
test("a pending decision is the blocker, and outranks a finished-looking card", () => {
  assert.deepEqual(cardBlocker({ heroKind: "decision", pendingQuestions: 1, expiredQuestions: 0 }), {
    kind: "decision",
    text: "1 question waiting on you",
  });
  assert.equal(
    cardBlocker({ heroKind: "decision", pendingQuestions: 3, expiredQuestions: 1 }).text,
    "4 questions waiting on you",
    "an expired question still needs an answer, so it counts",
  );
  // A card that also has an error is still blocked on the question: answering
  // is what resumes the worker, and reporting the error first would point the
  // reader at the wrong thing.
  assert.equal(cardBlocker({ heroKind: "error", activity: "error", pendingQuestions: 1 }).kind, "decision");
});

test("a failure is the blocker only when nothing is being decided", () => {
  assert.equal(cardBlocker({ heroKind: "error", activity: "error" }).kind, "error");
  assert.equal(cardBlocker({ heroKind: "paused" }).kind, "paused");
  assert.equal(cardBlocker({ heroKind: "working", activity: "running" }), null, "a running card is not blocked");
  assert.equal(cardBlocker({ heroKind: "calm", activity: "idle" }), null, "a finished card is not blocked");
});

// An empty list is not "0 runs". A card that never dispatched a run tells a
// different story from one whose runs were all cleaned up, and neither is
// worth a row — so both are null.
test("no runs is no row, not a zero", () => {
  assert.equal(runTally([]), null);
  assert.equal(runTally(null), null);
  assert.equal(deliverableCount([]), null, "a card with no files has no file count to state");
  assert.equal(scopeTally([]), null, "a card that was never scoped has no scope tally");
});

test("the run tally reports failures first, then live states, then successes", () => {
  const runs = [
    { normalizedStatus: "succeeded" },
    { normalizedStatus: "succeeded" },
    { normalizedStatus: "failed" },
    { normalizedStatus: "running" },
    { normalizedStatus: "queued" },
  ];
  assert.deepEqual(
    runTally(runs).map((part) => part.text),
    ["1 failed", "2 running", "2 succeeded"],
    "the problem leads; queued and running are one state to a reader",
  );
  assert.equal(runTally(runs)[0].tone, "destructive", "a failure is never muted");
  assert.equal(
    runTally([{ normalizedStatus: "needs_input" }])[0].tone,
    "warning",
    "a run waiting on a person is a different state from a running one",
  );
});

test("evidence is not a deliverable, and scopes count what is done", () => {
  assert.equal(
    deliverableCount([{ role: "spec" }, { role: "evidence" }, { role: "code" }]),
    2,
    "evidence is kept for audit, not counted as a deliverable",
  );
  assert.equal(scopeTally([{ status: "done" }, { status: "done" }, { status: "in-progress" }]), "2/3 scopes done");
  assert.equal(scopeTally([{ status: "in-progress" }]), "1 scopes", "nothing done yet still reports the plan's size");
});

test("the summary renders nothing when it would say nothing", () => {
  const empty = {
    heroKind: "working", activity: "running", status: "in-progress", stage: "critique",
    runs: [], artifacts: [], scopes: [], pendingQuestions: 0, expiredQuestions: 0, stageLabel: label,
  };
  assert.equal(cardSummary(empty), null, "no blocker, no runs, no files, no scopes — nothing to add above the fold");
});

test("the summary states only what the loaded data supports", () => {
  const early = cardSummary({
    heroKind: "working", activity: "running", status: "in-progress", stage: "critique",
    runs: [], artifacts: [], scopes: [], pendingQuestions: 0, expiredQuestions: 0, stageLabel: label,
  });
  assert.equal(early, null, "a card mid-flight has nothing to summarize yet");

  const midFlight = cardSummary({
    heroKind: "working", activity: "running", status: "in-progress", stage: "execution",
    runs: [{ normalizedStatus: "running" }, { normalizedStatus: "failed" }],
    artifacts: [{ role: "spec" }], scopes: [{ status: "in-progress" }, { status: "done" }],
    pendingQuestions: 0, expiredQuestions: 0, stageLabel: label,
  });
  assert.equal(midFlight.stage, "Stage:execution", "the stage is named, not raw");
  assert.equal(midFlight.files, 1);
  assert.equal(midFlight.scoped, "1/2 scopes done");
  assert.equal(midFlight.terminal, false, "an in-flight card is not terminal");
  assert.equal(midFlight.blocker, null, "a running card has nothing blocking it");
});

test("a blocked card carries its blocker through the summary", () => {
  const blocked = cardSummary({
    heroKind: "decision", activity: "awaiting-answer", status: "in-progress", stage: "plan-gate",
    runs: [{ normalizedStatus: "needs_input" }], artifacts: [], scopes: [],
    pendingQuestions: 1, expiredQuestions: 0, stageLabel: label,
  });
  assert.equal(blocked.blocker.kind, "decision");
  assert.equal(blocked.run[0].text, "1 waiting");
});

test("a finished card is terminal and says so", () => {
  const done = cardSummary({
    heroKind: "calm", activity: "idle", status: "completed", stage: "done",
    runs: [{ normalizedStatus: "succeeded" }], artifacts: [{ role: "spec" }, { role: "evidence" }],
    scopes: [{ status: "done" }], pendingQuestions: 0, expiredQuestions: 0, stageLabel: label,
  });
  assert.equal(done.terminal, true);
  assert.equal(done.files, 1, "the evidence row is not a deliverable");
  assert.equal(done.blocker, null, "a finished card is not blocked");
});



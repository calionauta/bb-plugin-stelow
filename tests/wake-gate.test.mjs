import assert from "node:assert/strict";
import test from "node:test";
import { MAX_RESUME_ATTEMPTS, shouldWake, wakeFingerprint } from "../lib/wake-gate.mjs";

// The wake gate: should a scheduled visit spend a model turn on this card?
//
// Every assertion here is a cost claim. The failure this file guards against is
// not a wrong sentence on a card — it is a thread spawned, a model turn spent,
// and a person reading "no action" for the sixth time (bb-plugin-stelow#385).
// So each test names the refusal it expects, and the two that matter most are
// the ones that must NOT wake: a card parked on a human, and a card whose
// automatic attempts are spent.

test("a card waiting on a human never wakes: the visit cannot answer for them", () => {
  const verdict = shouldWake({ status: "in-progress", activity: "awaiting-answer" });
  assert.equal(verdict.wake, false);
  // The reason has to name the cause, not a symptom. A card in
  // `awaiting-answer` also looks idle-ish and may carry a stale error; a gate
  // that reported either of those would send a reader to fix the wrong thing.
  assert.match(verdict.reason, /waiting on a human answer/);
});

test("awaiting-answer outranks a stale error on the same card", () => {
  const verdict = shouldWake({
    status: "in-progress",
    activity: "awaiting-answer",
    lastError: "stale transport fault from an earlier read",
  });
  assert.equal(verdict.wake, false);
  assert.match(verdict.reason, /waiting on a human answer/, "cause beats symptom");
});

test("a terminal card never wakes, whatever else its row says", () => {
  for (const status of ["completed", "archived", "blocked"]) {
    const verdict = shouldWake({ status, activity: "idle", lastError: null });
    assert.equal(verdict.wake, false, `${status} is not work`);
    assert.match(verdict.reason, new RegExp(`card is ${status}`));
  }
});

test("an idle card with budget left wakes, and says how long it has been idle", () => {
  const now = 1_000_000;
  const verdict = shouldWake({
    status: "in-progress",
    activity: "idle",
    lastIdleAt: now - 120_000,
    now,
    autoCount: 0,
  });
  assert.equal(verdict.wake, true);
  assert.match(verdict.reason, /parked idle for 120s/);
});

test("an idle card whose resume budget is spent does not wake: stuck, not chatty", () => {
  const verdict = shouldWake({
    status: "in-progress",
    activity: "idle",
    autoCount: MAX_RESUME_ATTEMPTS,
  });
  assert.equal(verdict.wake, false);
  assert.match(verdict.reason, /resume budget is spent/);
});

test("the budget boundary is exact: one below wakes, exactly at the cap does not", () => {
  const base = { status: "in-progress", activity: "idle" };
  assert.equal(shouldWake({ ...base, autoCount: MAX_RESUME_ATTEMPTS - 1 }).wake, true);
  assert.equal(shouldWake({ ...base, autoCount: MAX_RESUME_ATTEMPTS }).wake, false);
});

test("a state the last visit already saw does not wake again", () => {
  const verdict = shouldWake({
    status: "in-progress",
    activity: "idle",
    stage: "build",
    unchangedSinceVisit: true,
  });
  assert.equal(verdict.wake, false);
  assert.match(verdict.reason, /has not moved since the last visit/);
  // The reason has to name the state, or a reader cannot tell "nothing changed"
  // from "the gate is broken".
  assert.match(verdict.reason, /idle at build/);
});

test("the unchanged refusal never replaces a more specific one", () => {
  const verdict = shouldWake({
    status: "in-progress",
    activity: "awaiting-answer",
    unchangedSinceVisit: true,
  });
  assert.equal(verdict.wake, false);
  assert.match(verdict.reason, /waiting on a human answer/, "cause beats the gate's own memory");
});

test("the fingerprint follows what a visit could change and ignores what a visit moves", () => {
  const base = { status: "in-progress", activity: "idle", stage: "build", lastError: null };
  assert.equal(wakeFingerprint(base), wakeFingerprint({ ...base }), "the same state is the same key");
  assert.notEqual(wakeFingerprint(base), wakeFingerprint({ ...base, stage: "review" }), "a stage advance is news");
  assert.notEqual(wakeFingerprint(base), wakeFingerprint({ ...base, activity: "running" }), "a live turn is news");
  assert.notEqual(wakeFingerprint(base), wakeFingerprint({ ...base, lastError: "boom" }), "a failure is news");
  assert.notEqual(wakeFingerprint(base), wakeFingerprint({ ...base, status: "completed" }), "a status move is news");
});

test("an idle card at a new state wakes even if a visit already happened at the old one", () => {
  const before = wakeFingerprint({ status: "in-progress", activity: "idle", stage: "build" });
  const after = wakeFingerprint({ status: "in-progress", activity: "idle", stage: "review" });
  // The command compares these and passes the boolean; this asserts the two
  // halves agree, so a fingerprint that ignored the stage cannot pass here.
  const verdict = shouldWake({
    status: "in-progress",
    activity: "idle",
    stage: "review",
    unchangedSinceVisit: before === after,
  });
  assert.equal(verdict.wake, true);
});

test("a running card does not wake: the visit would race the live turn", () => {
  const verdict = shouldWake({ status: "in-progress", activity: "running" });
  assert.equal(verdict.wake, false);
  assert.match(verdict.reason, /already running/);
});

test("an unreadable host does not wake: the turn would be spent blind", () => {
  const verdict = shouldWake({
    status: "in-progress",
    activity: "idle",
    readUnreachable: true,
  });
  assert.equal(verdict.wake, false);
  assert.match(verdict.reason, /not answering this card's state read/);
});

test("an error wakes only while automatic attempts remain", () => {
  const fresh = shouldWake({
    status: "in-progress",
    activity: "idle",
    lastError: "boom",
    autoCount: 0,
  });
  assert.equal(fresh.wake, true, "a fresh error is real work worth one visit");

  const spent = shouldWake({
    status: "in-progress",
    activity: "idle",
    lastError: "boom",
    autoCount: MAX_RESUME_ATTEMPTS,
  });
  assert.equal(spent.wake, false);
  assert.match(spent.reason, /needs a person/);
});

test("an activity the gate does not model refuses to wake and names the value", () => {
  const verdict = shouldWake({ status: "in-progress", activity: "held" });
  assert.equal(verdict.wake, false);
  // Naming the unmodelled value is the point: it is the difference between a
  // reader learning the gate needs a case, and a reader learning nothing.
  assert.match(verdict.reason, /"held"/);
  assert.match(verdict.reason, /not one this gate models/);
});

test("every verdict carries a reason, because a silent skip is unactionable", () => {
  const samples = [
    { status: "completed", activity: "idle" },
    { status: "in-progress", activity: "awaiting-answer" },
    { status: "in-progress", activity: "running" },
    { status: "in-progress", activity: "idle", autoCount: MAX_RESUME_ATTEMPTS },
    { status: "in-progress", activity: "idle", autoCount: 0 },
  ];
  for (const sample of samples) {
    const verdict = shouldWake(sample);
    assert.equal(typeof verdict.reason, "string");
    assert.ok(verdict.reason.length > 10, `a reason must say something: ${JSON.stringify(sample)}`);
  }
});

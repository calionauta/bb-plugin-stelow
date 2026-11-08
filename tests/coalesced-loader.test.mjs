import assert from "node:assert/strict";
import test from "node:test";
import { createCoalescedLoader } from "../lib/coalesced-loader.mjs";

/**
 * One panel load at a time, one queued behind it.
 *
 * The measured failure: 12+ overlapping `cardDetail` calls for one card in the
 * same minute, 33 s average, because the mount, a realtime burst and an
 * `onChanged` callback each started a full sweep. The read takes ~140 ms alone,
 * so the cost was contention, not the read.
 *
 * These assertions are behavioral on purpose: they run the loader and count
 * passes. A pin on the hook's source would pass while the loads still overlapped.
 */

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("a second caller joins the run instead of starting a parallel pass", async () => {
  let passes = 0;
  const gate = deferred();
  const load = createCoalescedLoader(async () => {
    passes += 1;
    await gate.promise;
  });

  const first = load();
  const second = load();
  assert.equal(passes, 1, "the second call did not start a second pass");

  gate.resolve();
  await Promise.all([first, second]);
  // The second caller asked for fresh state, so exactly one follow-up runs.
  assert.equal(passes, 2, "the coalesced caller got one follow-up pass, not none");
});

test("a burst of callers produces one run plus one follow-up, never more", async () => {
  let passes = 0;
  const gate = deferred();
  const load = createCoalescedLoader(async () => {
    passes += 1;
    if (passes === 1) await gate.promise;
  });

  const first = load();
  const burst = Array.from({ length: 12 }, () => load());
  assert.equal(passes, 1, "twelve arrivals start one pass");

  gate.resolve();
  await Promise.all([first, ...burst]);
  assert.equal(passes, 2, "and share a single follow-up between them");
});

test("a caller arriving after everything settles starts a fresh pass", async () => {
  let passes = 0;
  const load = createCoalescedLoader(async () => {
    passes += 1;
  });

  await load();
  assert.equal(passes, 1);
  await load();
  assert.equal(passes, 2, "an idle loader is not stuck believing it is busy");
});

test("a failed pass does not wedge the loader", async () => {
  let passes = 0;
  let failNext = true;
  const load = createCoalescedLoader(async () => {
    passes += 1;
    if (failNext) throw new Error("boom");
  });

  await assert.rejects(load(), /boom/);
  failNext = false;
  await load();
  assert.equal(passes, 2, "the next request runs after a failure");
});

test("a queued caller still gets its follow-up when the first pass fails", async () => {
  let passes = 0;
  const gate = deferred();
  const load = createCoalescedLoader(async () => {
    passes += 1;
    if (passes === 1) {
      await gate.promise;
      throw new Error("first pass failed");
    }
  });

  const first = load();
  const second = load();
  gate.resolve();

  await assert.rejects(first, /first pass failed/);
  await second;
  assert.equal(passes, 2, "the follow-up ran despite the rejected pass");
});

test("the loader is busy only while a pass is running", async () => {
  let passes = 0;
  const gate = deferred();
  const load = createCoalescedLoader(async () => {
    passes += 1;
    await gate.promise;
  });

  const running = load();
  await tick();
  assert.equal(passes, 1, "one pass in flight");

  gate.resolve();
  await running;
  await load();
  assert.equal(passes, 2, "and the next call is free to run");
});

console.log(
  "coalesced loader ok: one pass in flight, one follow-up shared, "
  + "and a failure never wedges it",
);

import assert from "node:assert/strict";
import test from "node:test";
import { card, harness } from "./helpers/build-thread-sync-harness.mjs";

// card_e3u00eb4 / thr_vn9bh2yaac, 2026-09-30. The host was at 4 of 4 running,
// so every continuation the plugin sent was held rather than dispatched — and
// `threads.send` did not throw, so the plugin read each one as a resume. The
// card said `running` for ten minutes on an idle thread, spent its whole
// auto-continue budget on turns that never started, queued ten identical
// nudges, and then parked itself as "Idle with unfinished work — retry
// continues in place" with a Resume button that would have queued an eleventh.
// It then resumed on its own at 19:21:49, which is the whole point: the host
// was always going to release it.
const heldByHost = (extra = {}) => ({
  kind: "capacity",
  holderId: "concurrency-limit",
  reason: "4 of 4 running on host ubuntu-8gb-hel1-1",
  queued: 1,
  ...extra,
});

test("a held card is reported as held, not as a pause that needs a person", async () => {
  const fixture = harness(
    card({ status: "in-progress", stage: "setup", activity: "running" }),
    { status: "idle", output: "fresh progress", state: "name: Useful\ncurrent_stage: setup\n", hold: heldByHost() },
  );
  await fixture.sync(fixture.row().id);

  const update = fixture.calls.find(([name, fields]) => name === "update" && fields.activity === "held");
  assert.deepEqual(update[1], { activity: "held", last_assistant_text: "fresh progress" });
  assert.equal(
    fixture.calls.some(([name, , kind]) => name === "inbox" && kind === "paused"),
    false,
    "a wait the host resolves on its own must not raise a row asking the reader to act",
  );
});

test("a held card is never nudged, so its queue cannot grow", async () => {
  const fixture = harness(
    card({ status: "in-progress", stage: "setup", activity: "running" }),
    { status: "idle", output: "fresh progress", state: "name: Useful\ncurrent_stage: setup\n", hold: heldByHost() },
  );
  // Two ticks, as the 45s interval really runs them.
  await fixture.sync(fixture.row().id);
  await fixture.sync(fixture.row().id);

  assert.equal(
    fixture.calls.filter(([name]) => name === "thread.send").length,
    0,
    "the pending message IS the pending work; a second nudge queues a duplicate of it",
  );
});

test("a held card spends no auto-continue budget", async () => {
  const fixture = harness(
    card({ status: "in-progress", stage: "setup", activity: "running", auto_continue_count: 4 }),
    { status: "idle", output: "fresh progress", state: "name: Useful\ncurrent_stage: setup\n", hold: heldByHost() },
  );
  await fixture.sync(fixture.row().id);

  assert.equal(
    fixture.calls.some(([name, fields]) => name === "update" && fields.auto_continue_count !== undefined),
    false,
    "a dispatch that never started is not a turn, and must not cost one",
  );
  assert.equal(fixture.row().auto_continue_count, 4);
});

test("a continuation the host queues is held, not a running card", async () => {
  // The card reads `running` here because the PREVIOUS tick put it there from a
  // send the host held. That is the loop this pins: the phantom running is
  // what made every following tick look like a fresh idle edge, and each of
  // those ticks queued another copy.
  const fixture = harness(
    card({ status: "in-progress", stage: "setup", activity: "running" }),
    {
      status: "idle",
      output: "fresh progress",
      state: "name: Useful\ncurrent_stage: setup\n",
      delivery: "queued",
      queuedMessage: {
        waitingOn: { kind: "plugin", pluginId: "concurrency-limit", reason: "4 of 4 running on host ubuntu-8gb-hel1-1" },
      },
    },
  );
  await fixture.sync(fixture.row().id);

  assert.equal(
    fixture.calls.some(([name, fields]) => name === "update" && fields.activity === "running"),
    false,
    "a queued message is not a running turn",
  );
  assert.equal(fixture.calls.some(([name, fields]) => name === "update" && fields.activity === "held"), true);
  assert.equal(
    fixture.calls.some(([name, fields]) => name === "update" && fields.auto_continue_count !== undefined),
    false,
    "sending into a hold must not spend the budget either",
  );
});

test("a held card at audit is held, not parked with a spent-budget sentence", async () => {
  const fixture = harness(
    card({
      status: "in-progress",
      stage: "audit",
      activity: "running",
      auto_continue_count: 2,
      auto_continue_stage: "audit",
      last_idle_at: 9_800_000,
    }),
    { status: "idle", output: "done narrated", state: "name: Useful\ncurrent_stage: audit\n", now: 10_000_000, hold: heldByHost() },
  );
  await fixture.sync(fixture.row().id);

  assert.equal(
    fixture.calls.some(([name, , kind]) => name === "inbox" && kind === "paused"),
    false,
    "a held card is not parked, so it gets no park sentence",
  );
  assert.equal(fixture.calls.some(([name]) => name === "thread.send"), false);
});

test("an idle card with nothing held still resumes and still parks", async () => {
  // The negative control for every test above: with no hold in the queue, the
  // old behaviour must be untouched, or "a hold suppresses the park" would
  // pass by making parks impossible.
  const free = harness(
    card({ status: "in-progress", stage: "shape", activity: "running" }),
    { status: "idle", output: "fresh progress", state: "name: Useful\ncurrent_stage: shape\n", hold: null },
  );
  await free.sync(free.row().id);
  assert.equal(free.calls.some(([name]) => name === "thread.send"), true);
  assert.equal(free.row().activity, "running");

  const stuck = harness(
    card({ status: "in-progress", stage: "shape", activity: "running", last_assistant_text: "same output" }),
    { status: "idle", output: "same output", state: "name: Useful\ncurrent_stage: shape\n", hold: null },
  );
  await stuck.sync(stuck.row().id);
  assert.equal(stuck.row().activity, "idle");
  assert.equal(stuck.calls.some(([name, , kind]) => name === "inbox" && kind === "paused"), true);
});

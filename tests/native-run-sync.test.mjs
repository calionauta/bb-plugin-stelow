import assert from "node:assert/strict";
import test from "node:test";
import { card, harness } from "./helpers/build-thread-sync-harness.mjs";

/**
 * A card mid-workflow must not read as a card that stopped.
 *
 * card_cbnihg4c / 2026-09-30. The `planning-research` run was `running` on the
 * host while the coordinator thread sat idle — which is the normal shape of a
 * native run, because the run is a `bb workflows run` subprocess that outlives
 * the turn that started it. The plugin had a rule for exactly this
 * (`keepsCardRunning`) and nothing called it, so the 45s sync read the idle
 * thread, found no open question, took the idle branch, and told a card that
 * was working that it had stopped: a nudge it did not need, auto-continue
 * budget spent on turns with nothing to do with the run, and finally a
 * "paused" row with a Resume button that would have restarted a card mid-stage.
 *
 * These tests pin the rule at the only place it can act: the sync loop.
 */

const liveRun = (overrides = {}) => ({
  id: "exec_1",
  normalizedStatus: "running",
  recipeId: "planning-research",
  stage: "planning",
  stageLabel: "Tech planning",
  ...overrides,
});

const midRun = (overrides = {}) => harness(
  card({
    status: "in-progress",
    stage: "planning",
    activity: "running",
    last_assistant_text: "planning started",
  }),
  {
    status: "idle",
    output: "the run is working",
    state: "name: Useful\nintent: feature\ncurrent_stage: planning\n",
    hold: null,
    runs: [liveRun(overrides)],
    ...(overrides.state ? { state: overrides.state } : {}),
  },
);

test("a card with a live run is not nudged", async () => {
  const fixture = midRun();
  await fixture.sync(fixture.row().id);

  assert.equal(
    fixture.calls.filter(([name]) => name === "thread.send").length,
    0,
    "the run IS the pending work; a nudge interrupts a card that is mid-workflow",
  );
});

test("a card with a live run is never parked", async () => {
  // The tick that produced the bug. The output is UNCHANGED from the last one
  // the card saw, so the idle branch has no progress to credit and no budget
  // left to spend — which is exactly the tick that wrote the "paused" row and
  // the Resume button. Without the run check this card parks, every time.
  const fixture = harness(
    card({
      status: "in-progress",
      stage: "planning",
      activity: "running",
      last_assistant_text: "the run is working",
      auto_continue_count: 10,
      auto_continue_stage: "planning",
    }),
    {
      status: "idle",
      output: "the run is working",
      state: "name: Useful\nintent: feature\ncurrent_stage: planning\n",
      hold: null,
      runs: [liveRun()],
    },
  );
  await fixture.sync(fixture.row().id);

  assert.equal(
    fixture.calls.some(([name, , kind]) => name === "inbox" && kind === "paused"),
    false,
    "a run in flight must not raise a row offering a Resume for work already running",
  );
  assert.notEqual(fixture.row().activity, "idle", "the card must not claim to have stopped");
});

test("a card with a live run spends no auto-continue budget", async () => {
  const fixture = harness(
    card({
      status: "in-progress",
      stage: "planning",
      activity: "running",
      auto_continue_count: 4,
    }),
    {
      status: "idle",
      output: "the run is working",
      state: "name: Useful\nintent: feature\ncurrent_stage: planning\n",
      hold: null,
      runs: [liveRun()],
    },
  );
  await fixture.sync(fixture.row().id);

  assert.equal(
    fixture.calls.some(([name, fields]) => name === "update" && fields.auto_continue_count !== undefined),
    false,
    "a turn that has nothing to do with the run is not a turn",
  );
  assert.equal(fixture.row().auto_continue_count, 4, "the budget is left exactly as it was found");
});

test("a card with a live run clears the idle timestamp it does not have", async () => {
  const fixture = harness(
    card({
      status: "in-progress",
      stage: "planning",
      activity: "running",
      last_idle_at: 9_800_000,
    }),
    {
      status: "idle",
      output: "the run is working",
      state: "name: Useful\nintent: feature\ncurrent_stage: planning\n",
      hold: null,
      runs: [liveRun()],
    },
  );
  await fixture.sync(fixture.row().id);

  const update = fixture.calls.find(([name, fields]) => name === "update" && fields.activity === "running");
  assert.deepEqual(update[1], {
    activity: "running",
    last_assistant_text: "the run is working",
    last_idle_at: null,
  });
  assert.equal(fixture.row().last_idle_at, null, "a card that is not idle has no 'idle since' to show");
});

test("two ticks of a live run change nothing, because there is nothing to do", async () => {
  const fixture = midRun();
  await fixture.sync(fixture.row().id);
  await fixture.sync(fixture.row().id);

  assert.equal(fixture.calls.filter(([name]) => name === "thread.send").length, 0);
  assert.equal(fixture.calls.filter(([name, , kind]) => name === "inbox" && kind === "paused").length, 0);
});

test("a run that has finished releases the card back to the idle path", async () => {
  // The negative control, and the reason the rule is not a wedge: the moment
  // the run leaves the live set, the card must park and nudge exactly as it
  // always did. A guard that also blocked terminal runs would strand cards
  // whose workflow finished while nobody was looking.
  const done = harness(
    card({ status: "in-progress", stage: "shape", activity: "running" }),
    {
      status: "idle",
      output: "fresh progress",
      state: "name: Useful\nintent: feature\ncurrent_stage: shape\n",
      hold: null,
      runs: [liveRun({ normalizedStatus: "succeeded", stage: "shape", stageLabel: "Shape proposal" })],
    },
  );
  await done.sync(done.row().id);

  assert.equal(
    done.calls.some(([name]) => name === "thread.send"),
    true,
    "a card whose run finished is free to resume its own work",
  );
});

test("a card with an open question shows the question, not the run", async () => {
  // This is a question-branch test, and it is worth having — but it was NAMED
  // and COMMENTED as a run-guard test, and it is not one. With the whole run
  // guard deleted it still passed, because `syncIdle` returns on an open
  // question BEFORE the guard is reached. Claiming coverage the test does not
  // have is how a real gap hides behind a green suite.
  //
  // The run guard's own `needs_input` nuance is pinned where it is reachable:
  // in `native-run.test.mjs`, against `keepsCardRunning` directly.
  const fixture = harness(
    card({ status: "in-progress", stage: "planning", activity: "running" }),
    {
      status: "idle",
      output: "needs a decision",
      state: "name: Useful\nintent: feature\ncurrent_stage: planning\n",
      hold: null,
      questions: ["q1"],
      runs: [liveRun({ normalizedStatus: "needs_input" })],
    },
  );
  await fixture.sync(fixture.row().id);

  assert.equal(
    fixture.calls.some(([name]) => name === "thread.send"),
    false,
    "a question is the thing to show, not a nudge",
  );
  assert.equal(
    fixture.calls.some(([name, fields]) => name === "update" && fields.activity === "running"),
    false,
    "and the card does not claim to be working past a question it is asking",
  );
});

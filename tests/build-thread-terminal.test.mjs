// The terminal park: what a card at audit is told when the host stops
// resuming it, and what it is told about the turn that just ended.
//
// These moved out of tests/build-thread-sync.test.mjs when the refusal-signal
// work pushed that file past the 400-line budget. That is where they belonged:
// the sentences live in server/runtime/build-thread-terminal.ts and the sync
// is only the caller. The harness is shared, so both files read the same card
// row — a fixture change cannot make the two disagree about what a card is.
import assert from "node:assert/strict";
import test from "node:test";
import {
  card,
  harness,
  pausedSummary,
} from "./helpers/build-thread-sync-harness.mjs";

test("audit idle never implies completion when the done budget is spent", async () => {
  const fixture = harness(
    card({
      status: "in-progress",
      stage: "audit",
      activity: "running",
      auto_continue_count: 2,
      auto_continue_stage: "audit",
    }),
    {
      status: "idle",
      output: "audit narrated",
      state: "name: Useful\ncurrent_stage: audit\n",
    },
  );
  await fixture.sync(fixture.row().id);

  assert.equal(fixture.calls.some(([name]) => name === "thread.send"), false);
  assert.equal(
    fixture.calls.some(([name, fields]) => name === "update" && fields.status === "completed"),
    false,
  );
  // One comment, not two. The notice that used to be here claims the workflow
  // "reached the audit stage", and this fixture's card is ALREADY at stage
  // audit with the observed state also at audit — nothing transitioned during
  // this sync, so the notice was not true. It hung off `transitioning`, which
  // is derived from `activity`, and a native run flips activity; that is how
  // card_1fgz8lge re-announced the same arrival twice, minutes apart.
  assert.equal(fixture.calls.filter(([name]) => name === "comment").length, 1);
  assert.equal(fixture.calls.at(-1)[0], "escalate");
});

// The reader of a paused card gets one sentence, and it used to be the wrong
// one: "resume continues the worker with that instruction" was printed whether
// or not the host still had any instruction left to give. card_hh2nwqs4 sat
// on that sentence with the budget already spent and a done gate that refused
// for a reason no resume could touch, so the only thing the sentence taught a
// reader was to press Resume again.
test("a park at audit names the spent budget, not just the instruction", async () => {
  const spent = harness(
    card({
      status: "in-progress",
      stage: "audit",
      activity: "running",
      auto_continue_count: 2,
      auto_continue_stage: "audit",
      last_idle_at: 9_800_000,
    }),
    { status: "idle", output: "audit narrated", state: "name: Useful\ncurrent_stage: audit\n", now: 10_000_000 },
  );
  await spent.sync(spent.row().id);

  const spentPaused = pausedSummary(spent.calls, /audit/i);
  assert.match(spentPaused, /already resumed it 2 times/);
  assert.match(spentPaused, /Another resume repeats it/);

  // The other way the host declines to nudge is not a fresh idle edge. That
  // card gets the plain sentence — spent-budget wording on a card the host
  // would happily resume would be a lie in the other direction.
  const fresh = harness(
    card({ status: "in-progress", stage: "audit", activity: "idle", last_idle_at: 9_800_000 }),
    { status: "idle", output: "audit narrated", state: "name: Useful\ncurrent_stage: audit\n", now: 10_000_000 },
  );
  await fresh.sync(fresh.row().id);

  const plainPaused = pausedSummary(fresh.calls, /audit/i);
  assert.match(plainPaused, /resume continues the worker with that instruction/);
  assert.doesNotMatch(plainPaused, /already resumed/);
});

test("the audit notice says arrival, so it fires on the arrival and not after", async () => {
  const arriving = harness(
    card({
      status: "in-progress",
      stage: "execution",
      activity: "running",
      // The done budget has to be spent for the notice path to be reached at
      // all: with budget left, sendDoneNudge resumes the worker and returns
      // before anything is announced, which is the correct outcome.
      auto_continue_count: 2,
      auto_continue_stage: "audit",
    }),
    { status: "idle", output: "audit narrated", state: "name: Useful\ncurrent_stage: audit\n" },
  );
  await arriving.sync(arriving.row().id);
  const notices = () => arriving.calls.filter(([name, , body]) => name === "comment" && /reached the audit stage/.test(String(body)));
  assert.equal(notices().length, 1, "reaching audit announces it once");

  // Same card, still at audit, going idle again. The stage did not move, so the
  // card has nothing new to say about arriving.
  const staying = harness(
    card({
      status: "in-progress",
      stage: "audit",
      activity: "running",
      auto_continue_count: 2,
      auto_continue_stage: "audit",
    }),
    { status: "idle", output: "audit narrated again", state: "name: Useful\ncurrent_stage: audit\n" },
  );
  await staying.sync(staying.row().id);
  assert.equal(
    staying.calls.filter(([name, , body]) => name === "comment" && /reached the audit stage/.test(String(body))).length,
    0,
    "a card already at audit is not told it reached audit",
  );
});

// A card that ran `bb stelow done` and had the gate refuse it is not waiting to
// be told what to do — it already knows, and the answer is on the card. It used
// to get the generic "resume continues the worker with that instruction",
// which is what a card gets when the host has an instruction left to give.
// card_hh2nwqs4 parked there for hours with ten skipped rework scopes the gate
// had named only in stderr the worker read and then forgot.
test("a park at audit names the refusal when the finished turn ran done", async () => {
  const refusedTurn = (command, status, exitCode) => [
    { type: "turn/completed", data: { status: "completed" } },
    { type: "item/completed", data: { item: { type: "commandExecution", command, status, exitCode } } },
  ];
  // A real refused `done` looks like this: the command item completed and the
  // shell reported exit 1, because that is how the CLI refuses. Only the exit
  // code separates it from a done that passed.
  const refusedEvents = refusedTurn("bb stelow done", "completed", 1);
  const parked = (events) => harness(
    card({
      status: "in-progress",
      stage: "audit",
      activity: "running",
      auto_continue_count: 2,
      auto_continue_stage: "audit",
      last_idle_at: 9_800_000,
    }),
    { status: "idle", output: "audit narrated", state: "name: Useful\ncurrent_stage: audit\n", now: 10_000_000, events },
  );

  const refused = parked(refusedEvents);
  await refused.sync(refused.row().id);
  const refusedPaused = pausedSummary(refused.calls, /audit/i);
  assert.match(refusedPaused, /ran `bb stelow done` and the gate refused it/);
  assert.match(refusedPaused, /Resuming repeats the same refusal/);
  assert.doesNotMatch(refusedPaused, /resume continues the worker with that instruction/);

  // A done that came back clean is a different park, and says so: the card is
  // not complete, but nothing refused either. Collapsing it into the refusal
  // sentence would blame a gate that passed.
  const attempted = parked(refusedTurn("bb stelow done", "completed", 0));
  await attempted.sync(attempted.row().id);
  const attemptedPaused = pausedSummary(attempted.calls, /audit/i);
  assert.match(attemptedPaused, /ran `bb stelow done` and the card is not complete/);
  assert.doesNotMatch(attemptedPaused, /the gate refused it/);

  // A turn that ran no Stelow verb keeps the sentence it had, byte for byte.
  const silent = parked([]);
  await silent.sync(silent.row().id);
  assert.match(pausedSummary(silent.calls, /audit/i), /already resumed it 2 times with that/);
});

// The new signal chooses words, never action. A refused done is the moment a
// host is most tempted to stop nudging — "the worker was told no" reads like a
// reason to leave it alone — and that is exactly backwards: the gate refused
// because something on the card has to change, and only another turn can change
// it. The budget still governs the send; this signal cannot move it.
test("a refused done does not stop the done nudge", async () => {
  const fixture = harness(
    card({
      status: "in-progress",
      stage: "audit",
      activity: "running",
      auto_continue_count: 0,
      auto_continue_stage: null,
    }),
    {
      status: "idle",
      output: "gate said no",
      state: "name: Useful\ncurrent_stage: audit\n",
      events: [
        { type: "turn/completed", data: {} },
        { type: "item/completed", data: { item: { type: "commandExecution", command: "bb stelow done", status: "completed", exitCode: 1 } } },
      ],
    },
  );
  await fixture.sync(fixture.row().id);

  assert.equal(
    fixture.calls.some(([name]) => name === "thread.send"),
    true,
    "with budget left, a refused done is resumed exactly as before",
  );
  assert.equal(
    fixture.calls.some(([name]) => name === "inbox"),
    false,
    "and the worker that just got an answer is not parked",
  );
});

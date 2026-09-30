import assert from "node:assert/strict";
import test from "node:test";
import {
  projectRunningState,
  projectStateMetadata,
  shouldSyncThread,
} from "../server/runtime/thread-state-projection.ts";
import { card, harness } from "./helpers/build-thread-sync-harness.mjs";

test("active build sync projects state metadata and running activity", async () => {
  const fixture = harness(card());
  await fixture.sync(fixture.row().id);

  assert.equal(shouldSyncThread(fixture.row()), true);
  assert.equal(projectStateMetadata(card(), "name: Useful\nintent: feature\n").intent, "feature");
  assert.equal(projectStateMetadata(card(), "name: Other\nintent: feature\n").intent, null);
  assert.deepEqual(
    projectRunningState(card(), "planning", "working", []),
    { activity: "running", last_assistant_text: "working", last_error: null, status: "triage", stage: "planning" },
  );
  const running = fixture.calls.find(
    ([name, fields]) => name === "update" && fields.activity === "running",
  );
  assert.deepEqual(running[1], {
    activity: "running",
    last_assistant_text: "working",
    last_error: null,
    status: "triage",
    stage: "planning",
  });
  const intentWrite = fixture.calls.findIndex(
    ([name, sql]) => name === "run" && sql.includes("SET intent"),
  );
  const threadRead = fixture.calls.findIndex(([name]) => name === "thread.get");
  assert.ok(intentWrite >= 0 && intentWrite < threadRead, "intent persists before a remote thread read");
  assert.equal(fixture.calls.at(-1)[0], "escalate");
});

test("idle no-progress transition persists attention instead of resuming", async () => {
  const fixture = harness(
    card({
      status: "in-progress",
      stage: "shape",
      activity: "running",
      last_assistant_text: "same output",
    }),
    {
      status: "idle",
      output: "same output",
      state: "name: Useful\ncurrent_stage: shape\n",
    },
  );
  await fixture.sync(fixture.row().id);

  const update = fixture.calls.find(([name, fields]) => name === "update" && fields.activity === "idle");
  assert.equal(update[1].last_idle_at, 10_000, "a silent stop backdates one attention window");
  assert.equal(fixture.calls.some(([name]) => name === "thread.send"), false, "no progress never resumes");
  assert.equal(fixture.calls.some(([name, , kind]) => name === "inbox" && kind === "paused"), true);
  assert.equal(fixture.calls.some(([name]) => name === "escalate"), true);
});

test("successful idle recovery sends before recording its budget", async () => {
  const fixture = harness(
    card({ status: "in-progress", stage: "shape", activity: "running" }),
    { status: "idle", output: "fresh progress" },
  );
  await fixture.sync(fixture.row().id);

  const send = fixture.calls.findIndex(([name]) => name === "thread.send");
  const update = fixture.calls.findIndex(
    ([name, fields]) => name === "update" && fields.auto_continue_count === 1,
  );
  assert.ok(send >= 0 && send < update, "the card records recovery only after send succeeds");
  const sentInput = fixture.calls[send][1];
  assert.equal(sentInput.threadId, "thread_1");
  assert.equal(sentInput.mode, "auto");
  assert.equal(sentInput.input[0].visibility, "agent-only");
  assert.equal(fixture.calls.some(([name, , kind]) => name === "inbox" && kind === "paused"), false);
  assert.equal(fixture.calls.some(([name]) => name === "escalate"), false);
});

test("question-read uncertainty stops sync without changing the card", async () => {
  const fixture = harness(card(), { questions: null });
  await fixture.sync(fixture.row().id);

  assert.equal(fixture.calls.some(([name, fields]) => name === "update" && fields.activity), false);
  assert.equal(fixture.calls.some(([name]) => name === "escalate"), false);
});

test("idle question wait keeps position and still records fresh output", async () => {
  const fixture = harness(
    card({ stage: "planning", activity: "running" }),
    { status: "idle", output: "before question", questions: ["question_1"] },
  );
  await fixture.sync(fixture.row().id);

  const wait = fixture.calls.find(
    ([name, fields]) => name === "update" && fields.activity === "awaiting-answer",
  );
  assert.deepEqual(wait[1], {
    activity: "awaiting-answer",
    last_assistant_text: "before question",
  });
  assert.equal(
    fixture.calls.some(([name, , body]) => name === "comment" && body === "before question"),
    true,
  );
});

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

  const paused = spent.calls.find(([name, , , summary]) => name === "inbox" && /audit/i.test(String(summary)));
  assert.match(paused[3], /already resumed it 2 times/);
  assert.match(paused[3], /Another resume repeats it/);

  // The other way the host declines to nudge is not a fresh idle edge. That
  // card gets the plain sentence — spent-budget wording on a card the host
  // would happily resume would be a lie in the other direction.
  const fresh = harness(
    card({ status: "in-progress", stage: "audit", activity: "idle", last_idle_at: 9_800_000 }),
    { status: "idle", output: "audit narrated", state: "name: Useful\ncurrent_stage: audit\n", now: 10_000_000 },
  );
  await fresh.sync(fresh.row().id);

  const freshPaused = fresh.calls.find(([name, , , summary]) => name === "inbox" && /audit/i.test(String(summary)));
  assert.match(freshPaused[3], /resume continues the worker with that instruction/);
  assert.doesNotMatch(freshPaused[3], /already resumed/);
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

test("terminal and unverifiable ownership refusals are negative controls", async () => {
  const completed = harness(card({ status: "completed" }));
  await completed.sync("card_1");
  assert.deepEqual(completed.calls, [], "completed cards never read or write worker state");

  const unverifiable = harness(card({ dir_hash: "hash_1" }), { stateDir: null });
  await unverifiable.sync("card_1");
  assert.equal(unverifiable.calls.some(([name]) => name === "thread.get"), false);
  assert.match(
    unverifiable.calls.find(([name]) => name === "update")[1].last_error,
    /ownership cannot be verified/,
  );
});

// Two regressions with the same trigger and the same minute, and the fix has to
// tell them apart. `host-daemon.48.log` on 2026-09-30 recorded 26 event-loop
// stalls between 09:36:42 and 09:41:47 (max delay 29.6s) plus timed-out host
// RPCs; three cards flipped to the ownership error in the same second
// (09:40:37) and recovered on their own 71s later. The card had not lost its
// state — the host had stopped answering, and the sync turned a transport
// failure into a verdict about the card, an inbox error, and a card frozen on
// its last projection because the refusal returns before anything else runs.
test("an unreadable workspace is not a verdict about the card's state", async () => {
  const fixture = harness(card({ dir_hash: "hash_1", stage: "planning" }), { stateDir: "unreadable" });
  await fixture.sync(fixture.row().id);

  assert.deepEqual(
    fixture.calls.filter(([name]) => name === "update"),
    [],
    "a read the host never answered writes nothing — no error, no activity, no inbox",
  );
  assert.equal(
    fixture.calls.some(([name]) => name === "thread.get"),
    false,
    "an unreadable workspace is not a reason to stop syncing a live worker forever",
  );
});

test("a verified projection clears the failure the last tick reported", async () => {
  const fixture = harness(
    card({
      dir_hash: "hash_1",
      activity: "idle",
      last_error: "Workflow state ownership cannot be verified. Reseed this card; "
        + "project-root state is intentionally ignored.",
    }),
    { status: "active" },
  );
  await fixture.sync(fixture.row().id);

  const update = fixture.calls.find(([name, fields]) => name === "update" && fields.activity === "running");
  assert.equal(update[1].last_error, null, "the reseed instruction outlived the failure that wrote it");
  assert.equal(fixture.row().last_error, null);
});

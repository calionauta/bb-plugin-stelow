import assert from "node:assert/strict";
import test from "node:test";
import {
  projectRunningState,
  projectStateMetadata,
  shouldSyncThread,
} from "../server/runtime/thread-state-projection.ts";
import { card, harness } from "./helpers/build-thread-sync-harness.mjs";
import { OWNERSHIP_UNVERIFIED } from "../lib/ownership-refusal.mjs";


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

/**
 * An idle card whose finished turn produced NO new prose, so the cheap progress
 * signal says nothing and the turn's own verbs are the only evidence left.
 *
 * Shared by the two tests below because they are one decision read both ways: a
 * turn that advanced the stage is progress, and a turn that did not is not.
 * Written once so the pair cannot drift into testing different cards, and so
 * neither can grow past the function budget by repeating the fixture.
 */
function silentTurnRunning(command) {
  return harness(
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
      events: [
        { type: "turn/completed", data: { status: "completed" } },
        {
          type: "item/completed",
          data: {
            item: { type: "commandExecution", command, status: "completed", exitCode: 0 },
          },
        },
      ],
    },
  );
}

test("the finished turn's verbs are progress even when the text is identical", async () => {
  // The complement of the test above, and the reason that one is not enough.
  //
  // New text is the cheap progress signal, so the test above leaves `output` and
  // `last_assistant_text` identical and gets "no progress" — which is right, and
  // which passes just as happily when the whole turn-reading branch is dead. A
  // worker that only ran a command produces NO new text, and its progress is
  // visible solely in the verbs of the turn it just finished. If the sync stops
  // reading those verbs, this card stops being resumed, and nothing else in the
  // suite notices: the rule is unit-tested in `auto-continue.test.mjs`, so the
  // green suite would be measuring the lib and not the wiring.
  //
  // That is not hypothetical. A rebase left `lastTurnAdvancedStages` imported
  // here and uncalled, which compiled, which the lib's own tests covered, and
  // which nobody could see from reading the file — the import said the rule was
  // wired and nothing said otherwise. This test fails on a dead READ, which is
  // what a dead import actually is once it has been removed.
  const fixture = silentTurnRunning("bb stelow advance shape");
  await fixture.sync(fixture.row().id);

  assert.equal(
    fixture.calls.some(([name]) => name === "thread.send"),
    true,
    "a turn that advanced the stage is progress, however identical the prose",
  );
  assert.equal(
    fixture.calls.some(([name, , kind]) => name === "inbox" && kind === "paused"),
    false,
    "and it does not also park the card it just resumed",
  );
});

test("a turn that only asked for status is not an advance", async () => {
  // The negative control for the test above, and the reason that test can be
  // trusted: if any completed command counted as progress, the case above would
  // pass with the verb rule replaced by "something ran".
  const fixture = silentTurnRunning("bb stelow status");
  await fixture.sync(fixture.row().id);

  assert.equal(
    fixture.calls.some(([name]) => name === "thread.send"),
    false,
    "reading the state is not advancing it",
  );
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

test("terminal and unverifiable ownership refusals are negative controls", async () => {
  const completed = harness(card({ status: "completed" }));
  await completed.sync("card_1");
  assert.deepEqual(
    completed.calls.filter(([name]) => name !== "forgetUnreadable"),
    [],
    "completed cards never read or write worker state",
  );

  const unverifiable = harness(card({ dir_hash: "hash_1" }), { stateDir: null });
  await unverifiable.sync("card_1");
  assert.equal(unverifiable.calls.some(([name]) => name === "thread.get"), false);
  // Exact equality against the shared constant, not a regex: this is the one
  // place the sentence reaches a card, and a component three files over decides
  // which copy to render from its prefix. An inline literal here would let the
  // client render a different sentence than the server refused with, and no
  // regex would notice.
  assert.equal(
    unverifiable.calls.find(([name]) => name === "update")[1].last_error,
    OWNERSHIP_UNVERIFIED,
    "the written refusal is the one sentence every surface recognises",
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

// The trace is the whole point of the unreadable branch: silence keeps the card
// clean, but a host that stops answering leaves nothing to explain the next one.
// These four pin the shape of that trace — a counted miss, a byte-identical
// card, a reset when the host answers, and no counter left behind when the card
// leaves scope. The once-only warn itself is lib/host-read-streak's test.
test("a missed read is counted, and the card is still byte-identical", async () => {
  const fixture = harness(
    card({ dir_hash: "hash_1", activity: "idle", last_assistant_text: "earlier" }),
    { stateDir: "unreadable" },
  );
  const before = JSON.stringify(fixture.row());

  for (let tick = 0; tick < 6; tick += 1) await fixture.sync(fixture.row().id);

  assert.equal(
    fixture.calls.filter(([name]) => name === "noteUnreadable").length,
    6,
    "every missed tick is counted, so the streak can reach its threshold",
  );
  assert.equal(JSON.stringify(fixture.row()), before, "counting is not writing: no activity, no last_error, no updated_at");
  assert.equal(
    fixture.calls.some(([name]) => name === "noteReadable"),
    false,
    "a read that never arrived cannot read as a recovery",
  );
});

// A host that answers ends the outage. Without this the second failure of the
// day starts from a streak the first one left and its warn never fires.
test("a read that comes back resets the unreadable streak", async () => {
  const missed = harness(card({ dir_hash: "hash_1" }), { stateDir: "unreadable" });
  await missed.sync(missed.row().id);

  const answered = harness(card({ dir_hash: "hash_1" }), { status: "active" });
  await answered.sync(answered.row().id);

  assert.deepEqual(
    answered.calls.filter(([name]) => name === "noteReadable").map(([, id]) => id),
    ["card_1"],
    "a resolved read clears the streak, an ownership verdict too — both mean the host answered",
  );
});

// A card that leaves the sync's scope must not keep a counter alive for itself.
test("a card out of sync scope drops its unreadable streak", async () => {
  const completed = harness(card({ status: "completed" }));
  await completed.sync("card_1");

  assert.deepEqual(
    completed.calls.filter(([name]) => name === "forgetUnreadable"),
    [["forgetUnreadable", "card_1"]],
    "the streak dies with the scope, not with the process",
  );
  assert.equal(
    completed.calls.some(([name]) => name === "noteUnreadable"),
    false,
    "a card nobody is watching cannot accumulate misses",
  );
});

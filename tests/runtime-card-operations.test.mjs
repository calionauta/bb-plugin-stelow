import assert from "node:assert/strict";
import test from "node:test";
import { WORKFLOW_STAGES } from "../lib/workflow-vocabulary.mjs";
import { createCardOperationsHandlers } from "../server/runtime/card-operations.ts";

function card(overrides = {}) {
  return {
    id: "card-1",
    kind: "build",
    status: "in-progress",
    stage: "execution",
    worker_thread_id: "thread-1",
    workspace_kind: "project",
    ...overrides,
  };
}

function harness(options = {}) {
  const calls = [];
  const cardValue = card();
  const deps = testDeps(calls, cardValue, options);
  return { handlers: createCardOperationsHandlers(deps), calls, cardValue };
}

function testDeps(calls, cardValue, { live = null, fresh = { ok: true, error: null }, held = null, heldOnSend = null }) {
  return {
    db: {
      prepare: () => ({
        get: () => {
          calls.push("open-proposal");
          return null;
        },
      }),
    },
    bb: testBb(calls, live, held, heldOnSend),
    getCard: () => cardValue,
    workers: testWorkers(calls, fresh),
    updateCard: (...args) => calls.push(["update", ...args]),
    releaseClaims: async () => calls.push("release"),
    recordStageEvent: (...args) => calls.push(["stage", ...args]),
    cardStageSlug: async () => "triage",
    fetchPendingAsks: async () => [],
    openExpiredQuestionIds: () => [],
    logCardComment: (...args) => {
      calls.push(["comment", ...args]);
      return "comment-1";
    },
    resetAutoContinue: () => ({ count: 0, stage: null }),
    buildNudge: () => "continue",
    buildContinueInput: (text) => [{ type: "text", mentions: [], text }],
    splitRequestNudge: "propose split",
    phaseEntryStages: {
      analysis: "analysis",
      planning: "planning",
      execution: "execution",
      review: "review",
    },
    // The real stage-to-phase map, because the same-column guard asks which
    // phase a card is in. A simplified stand-in would either miss the
    // intermediate stages (so a card mid-phase looks like it is in no phase) or
    // invent stages this fake does not model.
    stagePhases: Object.fromEntries(WORKFLOW_STAGES.map(({ id, phase }) => [id, phase])),
    errors: { cardNotFound: "not found", cardArchived: "archived" },
  };
}

function testBb(calls, live, held, heldOnSend) {
  const row = heldOnSend ?? held;
  return {
    sdk: {
      threads: {
        // The host answers a dispatch with a discriminated union. A fake that
        // returns nothing would make every caller read the missing field as a
        // dispatch, which is the bug this suite exists to keep fixed.
        send: async () => {
          calls.push("send");
          if (live) throw live;
          return row
            ? { ok: true, delivery: "queued", queuedMessage: row }
            : { ok: true, delivery: "sent" };
        },
        queuedMessages: {
          list: async () => {
            calls.push("queue.list");
            return held ? [held] : [];
          },
        },
      },
    },
    realtime: {
      publish: (...args) => calls.push(["publish", ...args]),
    },
  };
}

function testWorkers(calls, fresh) {
  return {
    fresh: async (...args) => {
      calls.push(["fresh", ...args]);
      return fresh;
    },
    stop: async (threadId) => calls.push(["stop", threadId]),
  };
}

test("retry reads the hold, then sends, resets the card and publishes its live state", async () => {
  const { handlers, calls } = harness();
  assert.deepEqual(await handlers.retryWorker({ cardId: "card-1" }), {
    ok: true,
    error: null,
  });
  // The queue read comes FIRST, before the send. That order is the fix: a retry
  // that sends before checking would queue a second copy of a message the host
  // is already holding, which is what card_e3u00eb4's ten stacked nudges were.
  assert.equal(calls[0], "queue.list");
  assert.equal(calls[1], "send");
  assert.deepEqual(calls[2], [
    "update",
    "card-1",
    {
      activity: "running",
      last_error: null,
      auto_continue_count: 0,
      auto_continue_stage: null,
    },
  ]);
  assert.deepEqual(calls[3], ["publish", "card-state", { cardId: "card-1" }]);
});

test("retry send failure is a negative control and never records a false resume", async () => {
  const { handlers, calls } = harness({ live: new Error("send failed") });
  assert.deepEqual(await handlers.retryWorker({ cardId: "card-1" }), {
    ok: false,
    error: "send failed",
  });
  assert.deepEqual(calls, ["queue.list", "send"]);
  assert.equal(calls.some(([name]) => name === "update"), false, "a failed send never records a resume");
});

// The hold the card used to hide behind a Resume button. The refusal has to
// name the way out, because a refusal that only says "no" is a deadlock with a
// good error message.
const hostHoldRow = {
  id: "qmsg_1",
  waitingOn: {
    kind: "plugin",
    pluginId: "concurrency-limit",
    reason: "4 of 4 running on host ubuntu-8gb-hel1-1",
  },
};

test("retry refuses a held card, names the release, and never sends", async () => {
  const { handlers, calls } = harness({ held: hostHoldRow });
  const result = await handlers.retryWorker({ cardId: "card-1" });

  assert.equal(result.ok, false);
  assert.match(result.error, /4 of 4 running on host ubuntu-8gb-hel1-1/);
  assert.match(result.error, /no action needed/, "the refusal names what releases it");
  assert.deepEqual(calls, ["queue.list"], "nothing is queued a second time");
});

// The narrow window: the hold read said clear, then the host filled up between
// the read and the send. The card must land on the hold, not on `running`.
test("a retry the host queues lands on held, not on running", async () => {
  const { handlers, calls } = harness({ held: null, heldOnSend: hostHoldRow });
  const result = await handlers.retryWorker({ cardId: "card-1" });

  assert.equal(result.ok, false);
  assert.match(result.error, /no action needed/);
  const update = calls.find(([name]) => name === "update");
  assert.equal(update[2].activity, "held", "the card is held, so it must not claim to be running");
  assert.equal(
    Object.hasOwn(update[2], "auto_continue_count"),
    false,
    "a dispatch the host held spends no auto-continue budget",
  );
});

test("parked phase move writes the checkpoint before spawn and rolls it back on failure", async () => {
  const { handlers, calls, cardValue } = harness({
    fresh: { ok: false, error: "spawn failed" },
  });
  cardValue.worker_thread_id = null;
  cardValue.stage = "triage";
  cardValue.status = "draft";
  // `planning`, not `execution`: a drag may only reach the NEXT phase, and this
  // test is about the spawn rollback, not about phase distance. Reaching the
  // spawn is the precondition for the behaviour under test.
  assert.deepEqual(
    await handlers.moveCard({ cardId: "card-1", status: "planning" }),
    { ok: false, error: "spawn failed" },
  );
  assert.deepEqual(calls[0], [
    "update",
    "card-1",
    { stage: "planning", status: "in-progress" },
  ]);
  assert.deepEqual(calls[1], ["fresh", "card-1", "start"]);
  assert.deepEqual(calls[2], [
    "update",
    "card-1",
    { stage: "triage", status: "draft" },
  ]);
});

test("parked phase move publishes only after the worker starts", async () => {
  const { handlers, calls, cardValue } = harness();
  cardValue.worker_thread_id = null;

  // The card is at `execution`, so `review` is the next phase. `analysis` would
  // now refuse as a rewind, which is a different test (card-move-phase-order).
  assert.deepEqual(
    await handlers.moveCard({ cardId: "card-1", status: "review" }),
    { ok: true, error: null },
  );
  assert.deepEqual(calls, [
    ["update", "card-1", { stage: "review", status: "in-progress" }],
    ["fresh", "card-1", "start"],
    ["publish", "card-state", { cardId: "card-1" }],
  ]);
});

test("active phase move updates the checkpoint without spawning or publishing", async () => {
  const { handlers, calls } = harness();

  assert.deepEqual(
    await handlers.moveCard({ cardId: "card-1", status: "review" }),
    { ok: true, error: null },
  );
  assert.deepEqual(calls, [
    ["update", "card-1", { stage: "review", status: "in-progress" }],
  ]);
});

test("split receipt is written only after the worker accepts the request", async () => {
  const { handlers, calls, cardValue } = harness();
  cardValue.kind = "build";
  cardValue.stage = "triage";
  assert.equal((await handlers.requestSplitProposal({ cardId: "card-1" })).ok, true);
  assert.equal(calls[0], "open-proposal");
  assert.equal(calls[1], "send");
  assert.equal(calls[2][0], "comment");
  assert.equal(calls[3][0], "publish");
});

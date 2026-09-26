import assert from "node:assert/strict";
import test from "node:test";
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

function testDeps(calls, cardValue, { live = null, fresh = { ok: true, error: null } }) {
  return {
    db: {
      prepare: () => ({
        get: () => {
          calls.push("open-proposal");
          return null;
        },
      }),
    },
    bb: testBb(calls, live),
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
    errors: { cardNotFound: "not found", cardArchived: "archived" },
  };
}

function testBb(calls, live) {
  return {
    sdk: {
      threads: {
        send: async () => {
          calls.push("send");
          if (live) throw live;
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

test("retry sends first, then resets the card and publishes its live state", async () => {
  const { handlers, calls } = harness();
  assert.deepEqual(await handlers.retryWorker({ cardId: "card-1" }), {
    ok: true,
    error: null,
  });
  assert.equal(calls[0], "send");
  assert.deepEqual(calls[1], [
    "update",
    "card-1",
    {
      activity: "running",
      last_error: null,
      auto_continue_count: 0,
      auto_continue_stage: null,
    },
  ]);
  assert.deepEqual(calls[2], ["publish", "card-state", { cardId: "card-1" }]);
});

test("retry send failure is a negative control and never records a false resume", async () => {
  const { handlers, calls } = harness({ live: new Error("send failed") });
  assert.deepEqual(await handlers.retryWorker({ cardId: "card-1" }), {
    ok: false,
    error: "send failed",
  });
  assert.deepEqual(calls, ["send"]);
});

test("parked phase move writes the checkpoint before spawn and rolls it back on failure", async () => {
  const { handlers, calls, cardValue } = harness({
    fresh: { ok: false, error: "spawn failed" },
  });
  cardValue.worker_thread_id = null;
  cardValue.stage = "triage";
  cardValue.status = "draft";
  assert.deepEqual(
    await handlers.moveCard({ cardId: "card-1", status: "execution" }),
    { ok: false, error: "spawn failed" },
  );
  assert.deepEqual(calls[0], [
    "update",
    "card-1",
    { stage: "execution", status: "in-progress" },
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

  assert.deepEqual(
    await handlers.moveCard({ cardId: "card-1", status: "analysis" }),
    { ok: true, error: null },
  );
  assert.deepEqual(calls, [
    ["update", "card-1", { stage: "analysis", status: "in-progress" }],
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

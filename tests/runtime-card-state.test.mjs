import assert from "node:assert/strict";
import test from "node:test";
import {
  createCardUpdater,
  createClaimWaiterNotifier,
} from "../server/runtime/card-state.ts";

function card(overrides = {}) {
  return {
    id: "card_1",
    status: "in-progress",
    activity: "idle",
    kind: "build",
    last_error: null,
    updated_at: 1,
    ...overrides,
  };
}

function updaterHarness(initial = card(), openQuestion = false) {
  let row = initial;
  const calls = [];
  const db = {
    open: true,
    prepare(sql) {
      return {
        get() {
          if (sql.includes("FROM cards")) return row;
          if (sql.includes("FROM inbox_events")) {
            return openQuestion ? { id: "question_1" } : undefined;
          }
          return undefined;
        },
        run(values) {
          calls.push(["write", sql, values]);
          row = { ...row, ...values, updated_at: values.updated_at ?? row.updated_at };
          return undefined;
        },
      };
    },
  };
  const bb = { realtime: { publish: (...args) => calls.push(["publish", ...args]) } };
  const updateCard = createCardUpdater({
    db,
    bb,
    now: () => 20,
    getCard: () => row,
    recordInbox: (...args) => calls.push(["record", ...args]),
    resolveInbox: (...args) => calls.push(["resolve", ...args]),
  });
  return { calls, updateCard, row: () => row };
}

test("card update preserves no-op and archived terminal guards", () => {
  const unchanged = updaterHarness();
  unchanged.updateCard("card_1", { status: "in-progress" });
  assert.deepEqual(unchanged.calls, []);

  const archived = updaterHarness(card({ status: "archived" }));
  archived.updateCard("card_1", { status: "in-progress", activity: "running" });
  assert.equal(archived.calls.length, 3);
  assert.doesNotMatch(archived.calls[0][1], /status/);
  assert.equal(archived.row().status, "archived");
});

test("card update resolves attention before recording completion and publishing", () => {
  const harness = updaterHarness();
  harness.updateCard("card_1", { status: "completed" });
  assert.deepEqual(
    harness.calls.map(([name]) => name),
    ["write", "resolve", "record", "publish"],
  );
  assert.equal(harness.calls[2][2], "completed");
});

test("card update suppresses completion only when explicitly requested", () => {
  const harness = updaterHarness();
  harness.updateCard("card_1", { status: "completed" }, { suppressCompletionEvent: true });
  assert.deepEqual(
    harness.calls.map(([name]) => name),
    ["write", "resolve", "publish"],
  );
});

test("card update supersedes a fresh error when a question is already open", () => {
  const harness = updaterHarness(card(), true);
  harness.updateCard("card_1", { activity: "error", last_error: "Failed" });
  assert.deepEqual(
    harness.calls.map(([name]) => name),
    ["write", "record", "resolve", "publish"],
  );
  assert.deepEqual(harness.calls[2].slice(1), [
    "card_1",
    20,
    ["error"],
    "superseded",
  ]);
});

test("card update write-time re-check never writes a stripped status key", () => {
  // Regression control: the changed keys and the written values must come from
  // the same read. If the values were re-derived from the post-await read, a
  // card archived mid-call would re-enter the write as status=undefined.
  let reads = 0;
  let row = card();
  const writes = [];
  const db = {
    open: true,
    prepare(sql) {
      return {
        get: () => row,
        run(values) {
          writes.push({ sql, values });
          return undefined;
        },
      };
    },
  };
  const updateCard = createCardUpdater({
    db,
    bb: { realtime: { publish: () => {} } },
    now: () => 20,
    getCard: () => {
      reads += 1;
      if (reads >= 2) row = card({ status: "archived" });
      return row;
    },
    recordInbox: () => {},
    resolveInbox: () => {},
  });

  updateCard("card_1", { status: "completed", activity: "running" });
  assert.equal(writes.length, 1);
  assert.doesNotMatch(writes[0].sql, /status/);
  assert.equal("status" in writes[0].values, false);
  assert.equal(writes[0].values.activity, "running");
});

test("claim waiters resume once and preserve clear, send, publish order", async () => {
  const calls = [];
  const notify = createClaimWaiterNotifier({
    db: {},
    bb: {
      sdk: { threads: { send: async (input) => calls.push(["send", input]) } },
      realtime: { publish: (...args) => calls.push(["publish", ...args]) },
    },
    now: () => 30,
    getCard: () => card({ worker_thread_id: "thread_1" }),
    resolveInbox: (...args) => calls.push(["resolve", ...args]),
    findWaiters: () => [
      { card_id: "card_1", scope: "a.ts" },
      { card_id: "card_1", scope: "b.ts" },
    ],
    clearWaiters: (_db, args) => calls.push(["clear", args]),
  });

  await notify("/project", ["a.ts"]);
  assert.deepEqual(
    calls.map(([name]) => name),
    ["resolve", "clear", "send", "publish"],
  );
  assert.match(calls[2][1].input[0].text, /Files you waited on are now free \(a\.ts\)/);
});

test("claim waiters share one resume timestamp across the sweep", async () => {
  // Regression control: cards freed by one release are one event, so a clock
  // that advances per read would otherwise give each waiter its own stamp.
  const resolved = [];
  let clock = 0;
  const notify = createClaimWaiterNotifier({
    db: {},
    bb: {
      sdk: { threads: { send: async () => {} } },
      realtime: { publish: () => {} },
    },
    now: () => (clock += 5),
    getCard: (id) => card({ id, worker_thread_id: `thread_${id}` }),
    resolveInbox: (cardId, at) => resolved.push([cardId, at]),
    findWaiters: () => [{ card_id: "card_1" }, { card_id: "card_2" }],
    clearWaiters: () => {},
  });

  await notify("/project", ["a.ts"]);
  assert.deepEqual(resolved, [["card_1", 5], ["card_2", 5]]);
});

test("claim waiter terminal cleanup is a negative control", async () => {
  const calls = [];
  const notify = createClaimWaiterNotifier({
    db: {},
    bb: {
      sdk: { threads: { send: async () => calls.push(["send"]) } },
      realtime: { publish: () => calls.push(["publish"]) },
    },
    now: () => 30,
    getCard: () => card({ status: "completed" }),
    resolveInbox: () => calls.push(["resolve"]),
    findWaiters: () => [{ card_id: "card_1", scope: null }],
    clearWaiters: (_db, args) => calls.push(["clear", args]),
  });
  await notify("/project", ["a.ts"]);
  assert.deepEqual(calls.map(([name]) => name), ["clear"]);
  assert.deepEqual(calls[0][1], { cardId: "card_1", workspacePath: undefined, files: undefined });
});

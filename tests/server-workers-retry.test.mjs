import assert from "node:assert/strict";
import test from "node:test";
import { createWorkerRetry } from "../server/workers-retry.ts";
import { workerTestDb } from "./helpers/worker-test-db.mjs";

function card(overrides = {}) {
  return {
    id: "card-1",
    status: "in-progress",
    worker_thread_id: "thread-old",
    worker_preset_id: "preset-a",
    last_assistant_text: null,
    spawn_retry_count: 0,
    spawn_retry_thread: null,
    last_error: null,
    ...overrides,
  };
}

// A respawn replaces worker_thread_id and the claim ledger lives in SQLite, so
// the card the retry sees must come from the row, not a frozen fixture.
function rowBackedCard(db, current) {
  return () => {
    const row = db.prepare(
      "SELECT worker_thread_id, worker_preset_id, spawn_retry_count, spawn_retry_thread FROM cards WHERE id = ?",
    ).get(current.id);
    if (!row) return undefined;
    return {
      ...current,
      worker_thread_id: row.worker_thread_id,
      worker_preset_id: row.worker_preset_id,
      spawn_retry_count: row.spawn_retry_count,
      spawn_retry_thread: row.spawn_retry_thread,
    };
  };
}

function retryHarness({
  current = card(),
  delayMs = 0,
  fresh,
  failedCause = async () => null,
  onUpdate = () => {},
  onComment = () => {},
  onPublish = () => {},
} = {}) {
  const db = workerTestDb();
  const state = { db, freshCalls: 0, comments: [], published: [] };
  // Seed the row so the DB-backed getCard reflects the scenario the test set up.
  db.prepare("UPDATE cards SET worker_thread_id = ?, worker_preset_id = ? WHERE id = ?")
    .run(current.worker_thread_id ?? null, current.worker_preset_id ?? null, current.id);
  const readCard = rowBackedCard(db, current);
  const retry = createWorkerRetry({
    db,
    getCard: readCard,
    updateCard: (cardId, fields) => {
      Object.assign(current, fields);
      onUpdate(cardId, fields);
    },
    comment: (cardId, body) => {
      state.comments.push([cardId, body]);
      onComment(cardId, body);
    },
    publish: (cardId) => {
      state.published.push(cardId);
      onPublish(cardId);
    },
    fresh: async (...args) => {
      state.freshCalls += 1;
      return fresh ? fresh(...args) : { ok: true, error: null };
    },
    failedCause: (threadId) => failedCause(threadId),
    retryDelayMs: () => delayMs,
  });
  state.retry = retry;
  return state;
}

test("retry timers recover valid failures and skip stale or disposed work", async () => {
  const recovered = retryHarness();
  await recovered.retry.applyFailed("card-1", "thread-old", "ApiError 502 Bad Gateway");
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(recovered.freshCalls, 1);
  assert.match(recovered.comments[0][1], /attempt 1\/3/);
  assert.deepEqual(recovered.published, ["card-1"]);
  recovered.retry.dispose();
  recovered.db.close();

  const stale = retryHarness({ current: card({ worker_thread_id: "thread-replaced" }) });
  await stale.retry.applyFailed("card-1", "thread-old", "ApiError 502 Bad Gateway");
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(stale.freshCalls, 0);
  stale.retry.dispose();
  stale.db.close();

  const disposed = retryHarness({ delayMs: 10 });
  await disposed.retry.applyFailed("card-1", "thread-old", "ApiError 502 Bad Gateway");
  disposed.retry.dispose();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(disposed.freshCalls, 0);
  disposed.db.close();
});

test("retry attempts reschedule once per failure and stop after exhaustion", async () => {
  const updates = [];
  const exhausted = retryHarness({
    onUpdate: (cardId, fields) => updates.push([cardId, fields]),
    fresh: async () => ({ ok: false, error: "ApiError 503 Service Unavailable" }),
  });
  await exhausted.retry.applyFailed("card-1", "thread-old", "ApiError 503 Service Unavailable");
  await exhausted.retry.applyFailed("card-1", "thread-old", "ApiError 503 Service Unavailable");
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(exhausted.freshCalls, 3);
  const claim = exhausted.db.prepare("SELECT spawn_retry_count AS count FROM cards").get();
  assert.equal(claim.count, 3);
  assert.match(updates.at(-1)[1].last_error, /retries exhausted/);
  exhausted.retry.dispose();
  exhausted.db.close();
});

test("retry claims persist and terminal workers never schedule recovery", async () => {
  const updates = [];
  const active = retryHarness({ onUpdate: (cardId, fields) => updates.push(fields) });
  await active.retry.applyFailed("card-1", "thread-old", "ApiError 502 Bad Gateway");
  const claimed = active.db.prepare(
    "SELECT spawn_retry_count AS count, spawn_retry_thread AS thread FROM cards WHERE id = ?",
  ).get("card-1");
  assert.deepEqual(claimed, { count: 1, thread: "thread-old" });
  assert.equal(updates[0].activity, "running");
  active.retry.dispose();
  active.db.close();

  const terminalUpdates = [];
  const terminal = retryHarness({
    current: card({ status: "completed" }),
    onUpdate: (cardId, fields) => terminalUpdates.push(fields),
  });
  await terminal.retry.applyFailed("card-1", "thread-old", "ApiError 502 Bad Gateway");
  assert.deepEqual(terminalUpdates, []);
  assert.equal(terminal.db.prepare("SELECT spawn_retry_count AS count FROM cards").get().count, 0);
  terminal.retry.dispose();
  terminal.db.close();
});

// The 189-thread incident: every automatic respawn succeeded (`fresh` ok), the
// replacement then died before starting, and keying the budget to the failed
// thread handed it a fresh 1/3 each time. The episode must span replacements.
test("automatic retries keep one budget across replacement threads", async () => {
  const updates = [];
  let spawned = 0;
  const state = retryHarness({
    current: card({ worker_thread_id: "thread-0" }),
    onUpdate: (cardId, fields) => updates.push([cardId, fields]),
    fresh: async (cardId, reason, options) => {
      assert.equal(reason, "restart", "automatic recovery restarts the worker");
      assert.deepEqual(options, { automatic: true }, "automatic recovery flags the respawn");
      spawned += 1;
      // A real respawn replaces the thread; that replacement can die before it starts.
      state.db.prepare("UPDATE cards SET worker_thread_id = ? WHERE id = ?").run(`thread-${spawned}`, cardId);
      return { ok: true, error: null };
    },
  });
  const cause = "ApiError 502 Bad Gateway";

  for (const [index, threadId] of ["thread-0", "thread-1", "thread-2"].entries()) {
    await state.retry.applyFailed("card-1", threadId, cause);
    await new Promise((resolve) => setTimeout(resolve, 5));
    const attempt = index + 1;
    assert.match(state.comments.at(-1)[1], new RegExp(`attempt ${attempt}/3`), `replacement reaches attempt ${attempt}/3`);
    const claimed = state.db.prepare("SELECT spawn_retry_count AS count FROM cards").get();
    assert.equal(claimed.count, attempt, `replacement ${index} spends attempt ${attempt}, never restarts at 1`);
  }
  assert.equal(state.freshCalls, 3, "exactly three automatic respawns");

  await state.retry.applyFailed("card-1", "thread-3", cause);
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(state.freshCalls, 3, "an exhausted episode spawns no fourth thread");
  assert.equal(updates.at(-1)[1].activity, "error");
  assert.match(updates.at(-1)[1].last_error, /502 Bad Gateway/);
  state.retry.dispose();
  state.db.close();
});

// The generic wrapper is what `thread.failed` carries; the thread's own
// system/error detail names the real refusal. Retrying the wrapper forever is
// what turned a permanent "Method not found" into a spawn loop.
test("a specific failure cause outranks the generic thread.start wrapper", async () => {
  const specific = '"Method not found": session/set_model: {"method":"session/set_model"}';
  const updates = [];
  const state = retryHarness({
    current: card({ worker_thread_id: "thread-old" }),
    failedCause: async () => specific,
    onUpdate: (cardId, fields) => updates.push(fields),
  });

  await state.retry.applyFailed("card-1", "thread-old", "Command thread.start failed");
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(state.freshCalls, 0, "a permanent provider refusal never respawns");
  assert.equal(state.db.prepare("SELECT spawn_retry_count AS count FROM cards").get().count, 0, "no attempt is claimed");
  assert.equal(updates.at(-1).activity, "error");
  assert.match(updates.at(-1).last_error, /Method not found/);
  state.retry.dispose();
  state.db.close();
});

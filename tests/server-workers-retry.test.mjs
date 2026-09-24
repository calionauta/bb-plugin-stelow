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

function retryHarness({
  current = card(),
  delayMs = 0,
  fresh,
  onUpdate = () => {},
  onComment = () => {},
  onPublish = () => {},
} = {}) {
  const db = workerTestDb();
  const state = { db, freshCalls: 0, comments: [], published: [] };
  const retry = createWorkerRetry({
    db,
    getCard: () => current,
    updateCard: (cardId, fields) => onUpdate(cardId, fields),
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
    failedCause: async () => null,
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

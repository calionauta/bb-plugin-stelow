import assert from "node:assert/strict";
import { createWorkerRetry } from "../server/workers-retry.ts";

function fakeDb() {
  let count = 0;
  return {
    prepare: (sql) => {
      if (sql.startsWith("SELECT")) return { get: () => ({ spawn_retry_count: count, spawn_retry_thread: null }) };
      return { run: () => { count += 1; return {}; } };
    },
  };
}

function immediateScheduler() {
  return {
    setTimeout: (callback) => { callback(); return 1; },
    clearTimeout: () => undefined,
  };
}

function card() {
  return {
    id: "card-retry",
    status: "in-progress",
    worker_thread_id: "thr_dead",
    last_assistant_text: null,
    last_error: null,
    spawn_retry_count: 0,
    spawn_retry_thread: null,
  };
}

function harness(extra = {}) {
  const updated = [];
  const comments = [];
  let published = 0;
  const snapshot = card();
  const deps = {
    db: fakeDb(),
    getCard: () => snapshot,
    updateCard: (cardId, fields) => updated.push([cardId, fields]),
    comment: (cardId, body) => comments.push([cardId, body]),
    publish: () => { published += 1; },
    fresh: async () => ({ ok: true, error: null }),
    failedCause: async () => null,
    scheduler: immediateScheduler(),
    retryDelayMs: () => 0,
    ...extra,
  };
  const retry = createWorkerRetry(deps);
  return { retry, updated, comments, published: () => published, snapshot };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 10));

// Classified transient retries with no second opinion.
{
  const { retry, updated, published } = harness();
  await retry.applyFailed("card-retry", "thr_dead", "connection timeout after 30s");
  await flush();
  assert.ok(updated.some(([, fields]) => String(fields.last_error ?? "").includes("automatic retry 1/3")), "classified retry scheduled");
  assert.equal(published(), 1, "recovery published");
  retry.dispose();
}

// Unclassified failures fail fast: there is no judge on this path, so the
// card keeps the host's own words instead of spending budget on a guess.
{
  const { retry, updated, comments, published } = harness();
  await retry.applyFailed("card-retry", "thr_dead", "weird flake nobody classified");
  await flush();
  assert.ok(updated.some(([, fields]) => String(fields.last_error ?? "").includes("weird flake")), "original cause kept");
  assert.ok(!comments.some(([, body]) => body.includes("judged transient")), "no rescue comment");
  assert.equal(published(), 0, "nothing published");
  retry.dispose();
}

// A legacy judge key is ignored, never consulted: the failure path spends no
// model call deciding whether an unclassified error is transient.
{
  const judgeCalls = [];
  const { retry, updated } = harness({
    judgeTransientError: async (...args) => { judgeCalls.push(args); return true; },
  });
  await retry.applyFailed("card-retry", "thr_dead", "weird flake nobody classified");
  await flush();
  assert.equal(judgeCalls.length, 0, "no second opinion on the failure path");
  assert.ok(updated.some(([, fields]) => String(fields.last_error ?? "").includes("weird flake")), "fail-fast without a judge");
  retry.dispose();
}

console.log("worker retry judge test ok: classified retry, unclassified fail-fast, no second opinion");

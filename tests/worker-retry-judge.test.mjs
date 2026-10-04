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

function harness(judgeTransientError, judgeCalls) {
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
    ...(judgeTransientError ? {
      judgeTransientError: async (...args) => { judgeCalls.push(args); return judgeTransientError(...args); },
    } : {}),
  };
  const retry = createWorkerRetry(deps);
  return { retry, updated, comments, published: () => published, snapshot };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 10));

// Classified transient retries with NO judge consulted.
{
  const judgeCalls = [];
  const { retry, updated, published } = harness(async () => { throw new Error("judge must not run"); }, judgeCalls);
  await retry.applyFailed("card-retry", "thr_dead", "connection timeout after 30s");
  await flush();
  assert.equal(judgeCalls.length, 0, "classified errors never pay for a judgment");
  assert.ok(updated.some(([, fields]) => String(fields.last_error ?? "").includes("automatic retry 1/3")), "classified retry scheduled");
  assert.equal(published(), 1, "recovery published");
  retry.dispose();
}

// Unclassified + confident judge: rescued from the same bounded budget.
{
  const judgeCalls = [];
  const { retry, updated, comments, published } = harness(async () => true, judgeCalls);
  await retry.applyFailed("card-retry", "thr_dead", "weird flake nobody classified");
  await flush();
  assert.equal(judgeCalls.length, 1, "one judgment for the blind spot only");
  assert.deepEqual(judgeCalls[0][1], 1, "first attempt number reaches the judge");
  assert.ok(updated.some(([, fields]) => String(fields.last_error ?? "").includes("automatic retry 1/3")), "rescued retry scheduled");
  assert.ok(comments.some(([, body]) => body.includes("judged transient")), "rescue leaves a trail comment");
  assert.equal(published(), 1, "recovery published");
  retry.dispose();
}

// Unclassified + unconvinced judge: fail-fast, exactly like today.
{
  const judgeCalls = [];
  const { retry, updated, comments, published } = harness(async () => false, judgeCalls);
  await retry.applyFailed("card-retry", "thr_dead", "weird flake nobody classified");
  await flush();
  assert.equal(judgeCalls.length, 1, "judge consulted once");
  assert.ok(updated.some(([, fields]) => String(fields.last_error ?? "").includes("weird flake")), "original cause kept");
  assert.ok(!comments.some(([, body]) => body.includes("judged transient")), "no rescue comment");
  assert.equal(published(), 0, "nothing published");
  retry.dispose();
}

// No judge wired: fail-fast, today's behavior byte for byte.
{
  const { retry, updated } = harness(null, []);
  await retry.applyFailed("card-retry", "thr_dead", "weird flake nobody classified");
  await flush();
  assert.ok(updated.some(([, fields]) => String(fields.last_error ?? "").includes("weird flake")), "fail-fast without a judge");
  retry.dispose();
}

// Throwing judge: fail-fast, never throw out of the failure path.
{
  const { retry, updated } = harness(async () => { throw new Error("judge down"); }, []);
  await retry.applyFailed("card-retry", "thr_dead", "weird flake nobody classified");
  await flush();
  assert.ok(updated.some(([, fields]) => String(fields.last_error ?? "").includes("weird flake")), "judge failure keeps fail-fast");
  retry.dispose();
}

console.log("worker retry judge test ok: classified fast path, rescue, fail-fast, unwired, throwing judge");

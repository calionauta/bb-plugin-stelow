import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { claimScopeRetry } from "../lib/scope-retry.mjs";

function freshDb() {
  return new Database(":memory:");
}

// A throwing effect records a failure row before the error propagates:
// the same-key replay returns the recorded failure without re-executing.
{
  const db = freshDb();
  let writes = 0;
  const boom = () => {
    writes += 1;
    throw new Error("workspace write exploded");
  };
  assert.throws(
    () => claimScopeRetry(db, { batchId: "batch-1", scopeId: "scope-a", retryKey: "k-1", run: boom }),
    /workspace write exploded/,
    "the original error still propagates",
  );
  assert.equal(writes, 1, "the effect ran exactly once");
  const replay = claimScopeRetry(db, { batchId: "batch-1", scopeId: "scope-a", retryKey: "k-1", run: boom });
  assert.equal(replay.duplicate, true, "same-key replay after failure does not re-execute");
  assert.equal(writes, 1, "no second workspace side effect (counter stays 1)");
  assert.equal(replay.failed, true, "replay reports the recorded failure");
  assert.match(String(replay.outcome?.error ?? ""), /workspace write exploded/, "replay carries the failure outcome");
  const row = db.prepare("SELECT status FROM scope_retry_ledger WHERE batch_id = ? AND scope_id = ? AND retry_key = ?")
    .get("batch-1", "scope-a", "k-1");
  assert.equal(row.status, "failed", "a failure row exists in the ledger");
}

// Concurrent same-key claims never double-execute: the effect re-enters
// the same key (the only way two synchronous better-sqlite3 callers
// overlap) and the inner claim loses the INSERT OR IGNORE race.
{
  const db = freshDb();
  let writes = 0;
  let inner = null;
  const reentrant = () => {
    writes += 1;
    inner = claimScopeRetry(db, { batchId: "batch-1", scopeId: "scope-b", retryKey: "k-race", run: () => { writes += 1; return "inner"; } });
    return "outer";
  };
  const outer = claimScopeRetry(db, { batchId: "batch-1", scopeId: "scope-b", retryKey: "k-race", run: reentrant });
  assert.equal(outer.duplicate, false, "outer claim executes");
  assert.equal(writes, 1, "the re-entrant same-key claim never executed its effect");
  assert.equal(inner?.duplicate, true, "inner same-key claim reports duplicate");
  assert.equal(inner?.code, "RETRY_INFLIGHT", "the loser names the in-flight guard");
}

// Stale state refuses before the effect: revalidate sees a lapsed world
// and the retry records the refusal without touching the workspace.
{
  const db = freshDb();
  let writes = 0;
  const first = claimScopeRetry(db, {
    batchId: "batch-1",
    scopeId: "scope-c",
    retryKey: "k-stale",
    run: () => { writes += 1; return "effect"; },
    revalidate: () => ({ ok: false, reason: "batch cancelled mid-retry" }),
  });
  assert.equal(first.failed, true, "stale revalidation fails the retry");
  assert.equal(first.code, "RETRY_STALE", "refusal names RETRY_STALE");
  assert.equal(writes, 0, "the effect never ran on stale state");
  const replay = claimScopeRetry(db, {
    batchId: "batch-1",
    scopeId: "scope-c",
    retryKey: "k-stale",
    run: () => { writes += 1; return "effect"; },
  });
  assert.equal(replay.duplicate, true, "the stale refusal replays without re-executing");
  assert.equal(writes, 0, "still no workspace side effect");
}

// Mutation guard: deleting the failure-row write would re-execute on
// replay (counter 2). The pins above fail if failure rows are dropped.
assert.equal(freshDb() instanceof Database, true, "ledger database opens");

console.log("scope-retry-failure: ok");

import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { claimScopeRetry } from "../lib/scope-retry.mjs";

const db = new Database(":memory:");
let writes = 0;
function effect() {
  writes += 1;
  return { wrote: "src/out.ts", writes };
}

const first = claimScopeRetry(db, { batchId: "batch-1", scopeId: "scope-a", retryKey: "attempt-1", run: effect });
assert.equal(first.duplicate, false, "first execution runs the effect");
assert.equal(writes, 1, "one workspace effect");

const replay = claimScopeRetry(db, { batchId: "batch-1", scopeId: "scope-a", retryKey: "attempt-1", run: effect });
assert.equal(replay.duplicate, true, "same retryKey replays without re-executing");
assert.deepEqual(replay.outcome, first.outcome, "replay returns the prior outcome");
assert.equal(writes, 1, "no duplicate workspace or state.md side effect (counter stays 1)");

// A fresh key is a new attempt and runs once.
const second = claimScopeRetry(db, { batchId: "batch-1", scopeId: "scope-a", retryKey: "attempt-2", run: effect });
assert.equal(second.duplicate, false, "fresh retryKey executes");
assert.equal(writes, 2, "fresh key adds exactly one effect");

// Mutation guard: skipping the key check would double-execute (counter 2
// after the replay). The counter pin above fails if the guard is removed.
assert.equal(writes, 2, "retry ledger holds single effects per key (remove key check -> counter 3)");

console.log("scope-retry: ok");

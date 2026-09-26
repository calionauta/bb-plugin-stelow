import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { acquireScopeClaims, addClaimWaiters, ensureCardClaimsTables, liveClaimsForWorkspace } from "../lib/card-claims.mjs";
import { finishScope, isScopeTerminal } from "../lib/scope-batch-cleanup.mjs";

function freshDb() {
  const db = new Database(":memory:");
  ensureCardClaimsTables(db);
  return db;
}

function acquire(db, scopeId, outcome) {
  void outcome;
  return acquireScopeClaims(db, {
    cardId: "card-1",
    batchId: "batch-1",
    scopeId,
    files: [`src/${scopeId}.ts`],
    effectiveCheckout: "/repo",
    nowMs: 4_000_000,
  });
}

// Success, failure, and cancellation each release exactly their scope.
for (const outcome of ["succeeded", "failed", "cancelled"]) {
  const db = freshDb();
  assert.equal(acquire(db, "scope-a").ok, true, `${outcome}: setup acquires`);
  addClaimWaiters(db, { cardId: "card-2", workspacePath: "/repo", files: ["src/scope-a.ts"], scope: "batch-1::scope-b", nowMs: 4_000_001 });
  const done = finishScope(db, { batchId: "batch-1", scopeId: "scope-a", cardId: "card-1", outcome });
  assert.equal(done.released.length, 1, `${outcome}: releases exactly its claim`);
  assert.equal(done.notified.length, 1, `${outcome}: notifies the waiter exactly once`);
  assert.equal(done.notified[0].visibility, "agent-only", `${outcome}: notify is agent-only`);
  const live = liveClaimsForWorkspace(db, { workspacePath: "/repo", nowMs: 4_000_002 });
  assert.equal(live.filter((row) => row.scope === "batch-1::scope-a").length, 0, `${outcome}: zero live holders left`);
}

// Blocked is terminal: a blocked holder releases instead of leaking.
assert.equal(isScopeTerminal("blocked"), true, "blocked counts as terminal");
{
  const db = freshDb();
  assert.equal(acquire(db, "scope-z").ok, true, "blocked setup acquires");
  const done = finishScope(db, { batchId: "batch-1", scopeId: "scope-z", cardId: "card-1", outcome: "blocked" });
  assert.equal(done.terminal, true, "blocked finish reports terminal");
  assert.equal(done.released.length, 1, "blocked holder releases");
  const live = liveClaimsForWorkspace(db, { workspacePath: "/repo", nowMs: 4_000_002 });
  assert.equal(live.length, 0, "no leaked claim after blocked finish");
}

// Mutation guard: dropping blocked from the terminal set leaks the claim.
// This pin fails if blocked ever stops releasing.
{
  const db = freshDb();
  assert.equal(acquire(db, "scope-z").ok, true, "mutation-guard setup acquires");
  const done = finishScope(db, { batchId: "batch-1", scopeId: "scope-z", cardId: "card-1", outcome: "blocked" });
  assert.equal(done.terminal && done.released.length === 1, true, "blocked must release (remove blocked from terminal set -> fails)");
}

console.log("scope-cleanup: ok");

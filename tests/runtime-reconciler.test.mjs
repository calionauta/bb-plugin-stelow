import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import {
  acquireWorkspaceClaims,
  ensureCardClaimsTables,
  liveClaimsForWorkspace,
} from "../lib/card-claims.mjs";
import { startReconciler } from "../server/runtime/reconciler.ts";

function fixtureDb() {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE cards (id TEXT PRIMARY KEY, status TEXT, worker_thread_id TEXT)");
  db.prepare("INSERT INTO cards VALUES (?, ?, ?)").run("live", "in-progress", "thread-1");
  db.prepare("INSERT INTO cards VALUES (?, ?, ?)").run("done", "completed", null);
  ensureCardClaimsTables(db);
  acquireWorkspaceClaims(db, {
    cardId: "crashed", workspacePath: "/repo", files: ["old.ts"], nowMs: 1_000,
    ttlMs: 1_000,
  });
  acquireWorkspaceClaims(db, {
    cardId: "done", workspacePath: "/repo", files: ["done.ts"], nowMs: 10_000,
  });
  return db;
}

test("reconciler refreshes live cards, releases dead claims, and disposes its timer", () => {
  const db = fixtureDb();
  const calls = { synced: [], scopes: [], pruned: [], notified: [], severity: 0, cleared: false };
  let scheduledTick;
  const reconciler = startReconciler({
    db,
    now: () => 10_000,
    syncThreadState: async (id) => { calls.synced.push(id); },
    scopeProgress: {
      sync: async (id) => { calls.scopes.push(id); },
      prune: (ids) => { calls.pruned.push([...ids]); },
    },
    maybeBumpSeverity: async () => { calls.severity += 1; },
    notifyClaimWaiters: async (workspace, files) => { calls.notified.push([workspace, files]); },
    onError: (phase, error) => { throw new Error(`${phase}: ${error}`); },
    scheduler: {
      setInterval: (callback, delay) => {
        assert.equal(delay, 45_000);
        scheduledTick = callback;
        return 1;
      },
      clearInterval: (timer) => {
        assert.equal(timer, 1);
        calls.cleared = true;
      },
    },
  });
  try {
    scheduledTick();
    assert.deepEqual(calls.synced, ["live"]);
    assert.deepEqual(calls.scopes, ["live"]);
    assert.deepEqual(calls.pruned, [["live"]]);
    assert.deepEqual(calls.notified, [
      ["/repo", ["old.ts"]],
      ["/repo", ["done.ts"]],
    ]);
    assert.equal(calls.severity, 1);
    assert.equal(liveClaimsForWorkspace(db, { workspacePath: "/repo", nowMs: 10_000 }).length, 0);
    reconciler.dispose();
    assert.equal(calls.cleared, true);
    db.close();
    reconciler.tick();
    assert.equal(calls.severity, 1, "a closed database skips reconciliation");
  } finally {
    if (db.open) db.close();
  }
});

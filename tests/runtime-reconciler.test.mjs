import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import {
  acquireWorkspaceClaims,
  ensureCardClaimsTables,
  liveClaimsForWorkspace,
} from "../lib/card-claims.mjs";
import { startReconciler } from "../server/runtime/reconciler.ts";

const CARD_ROWS = [
  ["live", "in-progress", "thread-1"],
  ["done", "completed", null],
  // A finished card that still carries a worker thread. The old live-card query
  // stopped at `status != 'archived'`, so this row was selected every tick and
  // paid a projects.get round trip plus a stelow.json read to discover, again,
  // that it was finished. It is the shape that made the fix measurable.
  ["finished", "completed", "thread-2"],
  ["blocked", "blocked", "thread-3"],
];

function fixtureDb() {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE cards (id TEXT PRIMARY KEY, status TEXT, worker_thread_id TEXT)");
  // The tick sweeps inbox aging, so the fixture has to hold the table it
  // reads. It is created empty on purpose: this test owns the reconciler's
  // call order, not the sweep's scoring — `inbox-severity.test.mjs` owns that,
  // and a second copy of the ladder here would be a second place for it to be
  // wrong.
  db.exec(`CREATE TABLE inbox_events (
    id TEXT PRIMARY KEY, card_id TEXT NOT NULL, kind TEXT NOT NULL,
    summary TEXT NOT NULL, dedupe_key TEXT NOT NULL UNIQUE,
    occurred_at INTEGER NOT NULL, read_at INTEGER, archived_at INTEGER,
    resolved_at INTEGER, resolved_reason TEXT, severity INTEGER,
    severity_reasons TEXT, occurrences INTEGER
  )`);
  const insert = db.prepare("INSERT INTO cards VALUES (?, ?, ?)");
  for (const row of CARD_ROWS) insert.run(...row);
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
    assertLiveCardOnly(calls);
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

function assertLiveCardOnly(calls) {
  // Regression: a card that reached a terminal status must not be synced and
  // must not have its scope fingerprint read. Selecting on `status != 'archived'`
  // synced `finished` and `blocked` too, which is a projects.get round trip and a
  // disk read each, every tick, forever.
  assert.deepEqual(
    calls.synced,
    ["live"],
    "only the live card is synced; completed and blocked cards carry a thread but no work",
  );
  assert.deepEqual(calls.scopes, ["live"], "the scope fingerprint is read for the live card alone");
  assert.deepEqual(calls.pruned, [["live"]]);
  assert.deepEqual(calls.notified, [
    ["/repo", ["old.ts"]],
    ["/repo", ["done.ts"]],
  ]);
}

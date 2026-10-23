import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import {
  acquireWorkspaceClaims,
  ensureCardClaimsTables,
  liveClaimsForWorkspace,
} from "../lib/card-claims.mjs";
import { acquireScopeClaims } from "../lib/scope-claims.mjs";
import { startReconciler } from "../server/runtime/reconciler.ts";

const CARD_ROWS = [
  ["live", "in-progress", "thread-1", "running"],
  ["done", "completed", null, "idle"],
  // A finished card that still carries a worker thread. The old live-card query
  // stopped at `status != 'archived'`, so this row was selected every tick and
  // paid a projects.get round trip plus a stelow.json read to discover, again,
  // that it was finished. It is the shape that made the fix measurable.
  ["finished", "completed", "thread-2", "idle"],
  ["blocked", "blocked", "thread-3", "idle"],
];

function emptyDb() {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE cards (id TEXT PRIMARY KEY, status TEXT, worker_thread_id TEXT, activity TEXT)");
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
  ensureCardClaimsTables(db);
  return db;
}

function fixtureDb(rows = CARD_ROWS) {
  const db = emptyDb();
  const insert = db.prepare("INSERT INTO cards VALUES (?, ?, ?, ?)");
  for (const row of rows) insert.run(...row);
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

/**
 * One tick at `nowMs` against the registry, with the live-card sync and the
 * execution pass stubbed.
 *
 * The claims pass is the thing under test here: the sync fan-out has its own
 * assertions in the test above, and a stub keeps this one about the lease.
 */
function tickAt(db, nowMs) {
  let scheduled;
  const reconciler = startReconciler({
    db,
    now: () => nowMs,
    syncThreadState: async () => {},
    scopeProgress: { sync: async () => {}, prune: () => {} },
    maybeBumpSeverity: async () => {},
    notifyClaimWaiters: async () => {},
    onError: (phase, error) => { throw new Error(`${phase}: ${error}`); },
    scheduler: {
      setInterval: (callback) => { scheduled = callback; return 1; },
      clearInterval: () => {},
    },
  });
  try {
    scheduled();
  } finally {
    reconciler.dispose();
  }
}

const LEASE_TTL_MS = 60_000;

function scopedClaim(db, nowMs, cardId = "holder", scopeId = "scope-a") {
  return acquireScopeClaims(db, {
    cardId,
    batchId: "batch-1",
    scopeId,
    files: ["src/a.ts"],
    effectiveCheckout: "/repo",
    ttlMs: LEASE_TTL_MS,
    nowMs,
  });
}

test("a supervised holder's lease slides, so a scope outliving the TTL keeps its files", () => {
  const db = emptyDb();
  db.prepare("INSERT INTO cards VALUES (?, ?, ?, ?)").run("holder", "in-progress", "thread-1", "running");
  const T0 = 1_000_000;
  try {
    assert.equal(scopedClaim(db, T0).ok, true, "the scope acquires its file");
    // Past the midpoint of the lease, which is when a renewal is due. Without
    // the heartbeat the row below never moves and the claim lapses at T0+TTL,
    // which is precisely the window a 40-minute research scope runs in.
    tickAt(db, T0 + 40_000);
    const row = db.prepare("SELECT acquired_at, expires_at, fencing FROM card_claims").get();
    assert.equal(row.expires_at, T0 + 40_000 + LEASE_TTL_MS, "the lease slid by its own length");
    assert.equal(row.acquired_at, T0, "renewal is not an acquisition");
    assert.equal(row.fencing, 1, "a renewal never moves the fencing epoch");
    const foreign = acquireScopeClaims(db, {
      cardId: "other",
      batchId: "batch-2",
      scopeId: "scope-b",
      files: ["src/a.ts"],
      effectiveCheckout: "/repo",
      nowMs: T0 + LEASE_TTL_MS + 1,
    });
    assert.equal(foreign.ok, false, "past the original TTL the file is still the holder's");
    assert.equal(foreign.conflicts.length, 1, "and the refusal names the contested file");
  } finally {
    db.close();
  }
});

test("a holder the host stopped supervising is not renewed, and the takeover is reported", () => {
  const db = emptyDb();
  // `error` is what applyFailed writes once retries are exhausted: the worker
  // is gone, so nothing should be holding files on its behalf.
  db.prepare("INSERT INTO cards VALUES (?, ?, ?, ?)").run("holder", "in-progress", "thread-1", "error");
  const T0 = 2_000_000;
  try {
    assert.equal(scopedClaim(db, T0).ok, true, "the scope acquired its file");
    tickAt(db, T0 + 40_000);
    const row = db.prepare("SELECT expires_at FROM card_claims WHERE card_id = 'holder'").get();
    assert.equal(row.expires_at, T0 + LEASE_TTL_MS, "no renewal: the lease is left to run out");
    const foreign = acquireScopeClaims(db, {
      cardId: "other",
      batchId: "batch-2",
      scopeId: "scope-b",
      files: ["src/a.ts"],
      effectiveCheckout: "/repo",
      nowMs: T0 + LEASE_TTL_MS + 1,
    });
    assert.equal(foreign.ok, true, "the lapsed lease is takeable, which is what the TTL is for");
    assert.equal(foreign.stolen.length, 1, "the takeover is reported, never applied silently");
    assert.equal(foreign.stolen[0].previousHolder, "holder", "the report names the holder that lapsed");
    assert.equal(foreign.stolen[0].previousScope, "batch-1::scope-a", "and the scope it held under");
  } finally {
    db.close();
  }
});

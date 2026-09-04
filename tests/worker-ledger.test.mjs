import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { recordWorkerThread, stallCount, refreshRestartPending, healPresetStaleness } from "../lib/worker-ledger.mjs";

const db = new Database(":memory:");
db.exec(`
  CREATE TABLE cards (id TEXT PRIMARY KEY, worker_thread_id TEXT, worker_preset_id TEXT, preset_restart_pending INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE card_presets (card_id TEXT PRIMARY KEY, preset_id TEXT NOT NULL, assigned_at INTEGER NOT NULL);
  CREATE TABLE presets (id TEXT PRIMARY KEY, name TEXT NOT NULL);
  CREATE TABLE card_threads (thread_id TEXT PRIMARY KEY, card_id TEXT NOT NULL, preset_id TEXT, started_at INTEGER NOT NULL, ended_at INTEGER, ended_reason TEXT);
  CREATE TABLE inbox_events (id TEXT PRIMARY KEY, card_id TEXT NOT NULL, kind TEXT NOT NULL, summary TEXT NOT NULL, dedupe_key TEXT NOT NULL UNIQUE, occurred_at INTEGER NOT NULL, read_at INTEGER, archived_at INTEGER, resolved_at INTEGER);
`);
db.prepare("INSERT INTO cards VALUES (?, ?, ?, ?)").run("card_1", "thr_old", "preset_default", 0);
db.prepare("INSERT INTO presets VALUES (?, ?)").run("preset_default", "Default");

// Ledger: spawn closes the previous row with its reason, opens the current one.
recordWorkerThread(db, "card_1", "thr_old", "preset_default", "initial");
recordWorkerThread(db, "card_1", "thr_new", "preset_custom", "restart");
const rows = db.prepare("SELECT thread_id, ended_reason, ended_at FROM card_threads WHERE card_id = ? ORDER BY started_at").all("card_1");
assert.equal(rows.length, 2, "two ledger rows after one replacement");
assert.equal(rows[0].ended_reason, "restart", "previous row closed with the transition reason");
assert.ok(rows[0].ended_at !== null, "previous row is closed");
assert.equal(rows[1].ended_at, null, "new row stays open as the live worker");

// Stall count drives hero escalation copy.
assert.equal(stallCount(db, "card_1"), 0, "no stalls initially");
db.prepare("INSERT INTO inbox_events VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run("e1", "card_1", "paused", "p", "paused:card_1:1", 1, null, null, null);
db.prepare("INSERT INTO inbox_events VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run("e2", "card_1", "question", "q", "question:card_1:2", 2, null, null, 3);
assert.equal(stallCount(db, "card_1"), 1, "only paused events count as stalls");

// Flag transitions on assign: live worker + different preset -> pending.
assert.equal(refreshRestartPending(db, "card_1", "thr_new", "preset_default", "preset_custom"), 1, "divergent live worker flags restart");
assert.equal(db.prepare("SELECT preset_restart_pending AS f FROM cards WHERE id = ?").get("card_1").f, 1, "flag persists");
assert.equal(refreshRestartPending(db, "card_1", "thr_new", "preset_custom", "preset_custom"), 0, "aligned worker clears");
assert.equal(refreshRestartPending(db, "card_1", null, "preset_default", "preset_custom"), 0, "no worker means nothing pending");

// Self-heal: thread born before the override provably predates it.
db.prepare("INSERT OR REPLACE INTO card_presets VALUES (?, ?, ?)").run("card_1", "preset_custom", 2000);
assert.equal(healPresetStaleness(db, "card_1", 1000, false), true, "ancestral thread raises the flag");
assert.equal(healPresetStaleness(db, "card_1", 1000, true), false, "already-flagged never rewrites");
assert.equal(healPresetStaleness(db, "card_1", 3000, false), false, "newer thread is not stale");
assert.equal(healPresetStaleness(db, "card_1", null, false), false, "unknown birth stays best-effort");
assert.equal(healPresetStaleness(db, "card_1", "yesterday", false), false, "non-numeric birth stays best-effort");

db.close();
console.log("worker ledger test ok: ledger rotation, stalls, flag transitions, self-heal");

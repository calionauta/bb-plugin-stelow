import assert from "node:assert/strict";
import Database from "better-sqlite3";
import {
  MAX_SPAWN_RETRIES,
  claimSpawnRetry,
  isRetryableSpawnError,
  resetSpawnRetry,
  spawnRetryDelayMs,
} from "../lib/spawn-retry.mjs";

// Classification: transient start-phase infrastructure retries, everything
// else fails fast to the card + inbox.
assert.equal(isRetryableSpawnError("Failed to fetch skill tree: 404 Not Found - Skill tree not found"), true, "skill-tree 404 retries");
assert.equal(isRetryableSpawnError("Command thread.start failed"), true, "thread.start failure retries");
assert.equal(isRetryableSpawnError("ApiError 502 Bad Gateway"), true, "502 retries");
assert.equal(isRetryableSpawnError("503 Service Unavailable"), true, "503 retries");
assert.equal(isRetryableSpawnError("No active ACP session"), true, "lost host session retries");
assert.equal(isRetryableSpawnError("socket hang up"), true, "network blip retries");
assert.equal(isRetryableSpawnError("Provider error 400: Internal server error"), false, "provider 400 never retries");
assert.equal(isRetryableSpawnError("Provider error 401: invalid api key"), false, "auth failure never retries");
assert.equal(isRetryableSpawnError("This card's workflow state cannot be verified. Reseed it."), false, "reseed refusal never retries");
assert.equal(isRetryableSpawnError("This research has no known strategy. Archive it."), false, "strategy refusal never retries");
assert.equal(isRetryableSpawnError(""), false, "blank cause never retries");
assert.equal(isRetryableSpawnError(null), false, "null cause never retries");

// Backoff windows: attempt 1 → 1–2s, 2 → 2–4s, 3 → 4–8s.
assert.equal(spawnRetryDelayMs(1, () => 0), 1000, "attempt 1 floor is 1s");
assert.equal(spawnRetryDelayMs(1, () => 1), 2000, "attempt 1 ceiling is 2s");
assert.equal(spawnRetryDelayMs(2, () => 0), 2000, "attempt 2 floor is 2s");
assert.equal(spawnRetryDelayMs(2, () => 1), 4000, "attempt 2 ceiling is 4s");
assert.equal(spawnRetryDelayMs(3, () => 0), 4000, "attempt 3 floor is 4s");
assert.equal(spawnRetryDelayMs(3, () => 1), 8000, "attempt 3 ceiling is 8s");
const sampled = spawnRetryDelayMs(2);
assert.ok(sampled >= 2000 && sampled <= 4000, "default rand stays inside the window");
assert.equal(spawnRetryDelayMs(2, () => 5), 4000, "rand above 1 clamps to the ceiling");
assert.equal(spawnRetryDelayMs(2, () => -1), 2000, "rand below 0 clamps to the floor");
assert.equal(MAX_SPAWN_RETRIES, 3, "exactly 3 attempts");

// Claim ledger: attempts are scoped per thread, bounded, resettable.
const db = new Database(":memory:");
db.exec("CREATE TABLE cards (id TEXT PRIMARY KEY, spawn_retry_count INTEGER NOT NULL DEFAULT 0, spawn_retry_thread TEXT)");
db.prepare("INSERT INTO cards (id) VALUES (?)").run("card_1");

assert.equal(claimSpawnRetry(db, "card_1", "thr_a"), 1, "first claim is attempt 1");
assert.equal(claimSpawnRetry(db, "card_1", "thr_a"), 2, "second claim is attempt 2");
assert.equal(claimSpawnRetry(db, "card_1", "thr_a"), 3, "third claim is attempt 3");
assert.equal(claimSpawnRetry(db, "card_1", "thr_a"), 0, "fourth claim is exhausted");
assert.equal(claimSpawnRetry(db, "card_1", "thr_b"), 1, "a new failed thread starts a fresh episode");
assert.equal(claimSpawnRetry(db, "card_missing", "thr_a"), 0, "missing card claims nothing");
resetSpawnRetry(db, "card_1");
const reset = db.prepare("SELECT spawn_retry_count AS count, spawn_retry_thread AS thread FROM cards WHERE id = ?").get("card_1");
assert.equal(reset.count, 0, "reset clears the count");
assert.equal(reset.thread, null, "reset clears the thread scope");
assert.equal(claimSpawnRetry(db, "card_1", "thr_a"), 1, "post-reset claim restarts at 1");

db.close();
console.log("spawn-retry test ok: classification, backoff windows, per-thread claim ledger");

import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { QUESTION_WAITING_SUMMARY, ensureInboxResolvedReasonColumn, insertInboxEvent } from "../lib/inbox-events.mjs";
import { ensureInboxOccurrencesColumn } from "../lib/inbox-error-event.mjs";
import { kickQuestionSync, syncFreshQuestionInbox } from "../lib/question-sync-kick.mjs";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function createDb() {
  const db = new Database(":memory:");
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE cards (id TEXT PRIMARY KEY, display_name TEXT, name TEXT NOT NULL, project_id TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'build');
    CREATE TABLE inbox_events (
      id TEXT PRIMARY KEY, card_id TEXT NOT NULL, kind TEXT NOT NULL,
      summary TEXT NOT NULL, dedupe_key TEXT NOT NULL UNIQUE, occurred_at INTEGER NOT NULL,
      read_at INTEGER, archived_at INTEGER, resolved_at INTEGER,
      severity INTEGER NOT NULL DEFAULT 1, severity_reasons TEXT NOT NULL DEFAULT '[]',
      holder_card_id TEXT, holder_file TEXT,
      FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE
    );
    CREATE TABLE expired_questions (
      id TEXT PRIMARY KEY, card_id TEXT NOT NULL, thread_id TEXT NOT NULL,
      question TEXT NOT NULL, expired_at INTEGER NOT NULL, answered INTEGER NOT NULL DEFAULT 0
    );
  `);
  ensureInboxResolvedReasonColumn(db);
  ensureInboxOccurrencesColumn(db);
  db.prepare("INSERT INTO cards VALUES (?, ?, ?, ?, ?)").run("card_1", "Kick", "kick", "project_1", "build");
  return db;
}

function makeDeps(db, { asks, published, expiredIds = [], pendingAsks } = {}) {
  let serial = 0;
  return {
    db,
    bb: { realtime: { publish: (event, payload) => published.push({ event, payload }) } },
    pendingAsks: pendingAsks ?? (async () => asks),
    openExpiredQuestionIds: () => expiredIds,
    now: () => 1000,
    randomId: (prefix) => `${prefix}_${++serial}`,
    threadId: "thr_1",
    cardId: "card_1",
  };
}

const openQuestions = (db) => db.prepare("SELECT * FROM inbox_events WHERE card_id = 'card_1' AND kind = 'question'").all();

// A pending ask mints exactly one row with the shared waiting summary and publishes once.
{
  const db = createDb();
  const published = [];
  const result = await syncFreshQuestionInbox(makeDeps(db, { asks: [{ id: "ask_1" }], published }));
  assert.equal(result.inserted, 1, "a fresh pending ask inserts one row");
  const rows = openQuestions(db);
  assert.equal(rows.length, 1, "exactly one inbox row exists");
  assert.equal(rows[0].summary, QUESTION_WAITING_SUMMARY, "the row carries the shared waiting summary");
  assert.equal(rows[0].dedupe_key, "question:card_1:ask_1", "the row is keyed by the pending interaction");
  assert.deepEqual(published, [{ event: "inbox-changed", payload: { cardId: "card_1" } }], "the mint publishes once");
  // A second sync with the same open set is idempotent and stays silent.
  const again = await syncFreshQuestionInbox(makeDeps(db, { asks: [{ id: "ask_1" }], published }));
  assert.equal(again.inserted, 0, "re-polling the same ask inserts nothing");
  assert.equal(openQuestions(db).length, 1, "still exactly one row");
  assert.equal(published.length, 1, "an unchanged sync publishes nothing");
  db.close();
}

// An empty observation skips instead of resolving everything open as superseded.
{
  const db = createDb();
  insertInboxEvent(db, {
    id: "evt_seed", cardId: "card_1", kind: "question", summary: QUESTION_WAITING_SUMMARY,
    dedupeKey: "question:card_1:ask_9", occurredAt: 500,
  });
  const published = [];
  const result = await syncFreshQuestionInbox(makeDeps(db, { asks: [], published }));
  assert.equal(result, null, "an empty observation returns null");
  const rows = openQuestions(db);
  assert.equal(rows.length, 1, "the empty observation writes nothing");
  assert.equal(rows[0].resolved_at, null, "the other open question stays open, never superseded");
  assert.equal(published.length, 0, "an empty observation publishes nothing");
  db.close();
}

// A failed interaction read keeps the previous state: null, nothing written, nothing published.
{
  const db = createDb();
  const published = [];
  const throwing = await syncFreshQuestionInbox(makeDeps(db, { published, pendingAsks: async () => { throw new Error("boom"); } }));
  assert.equal(throwing, null, "a throwing read returns null");
  assert.equal(openQuestions(db).length, 0, "a throwing read writes nothing");
  assert.equal(published.length, 0, "a throwing read publishes nothing");
  const nullish = await syncFreshQuestionInbox(makeDeps(db, { published, pendingAsks: async () => null }));
  assert.equal(nullish, null, "a null read returns null");
  assert.equal(openQuestions(db).length, 0, "a null read writes nothing");
  assert.equal(published.length, 0, "a null read publishes nothing");
  db.close();
}

// kickQuestionSync fires the early sync; cancel() before firing prevents it.
{
  const db = createDb();
  const published = [];
  const cancel = kickQuestionSync(makeDeps(db, { asks: [{ id: "ask_k" }], published }), { threadId: "thr_1", cardId: "card_1", delayMs: 5 });
  await sleep(50);
  cancel();
  assert.equal(openQuestions(db).length, 1, "the kick mints the fresh question row");
  assert.equal(openQuestions(db)[0].summary, QUESTION_WAITING_SUMMARY, "the kicked row carries the shared summary");
  assert.equal(published.length, 1, "the kick publishes once");
  db.close();
}
{
  const db = createDb();
  const published = [];
  const cancel = kickQuestionSync(makeDeps(db, { asks: [{ id: "ask_k" }], published }), { threadId: "thr_1", cardId: "card_1", delayMs: 30 });
  cancel();
  await sleep(60);
  assert.equal(openQuestions(db).length, 0, "a cancelled kick writes nothing");
  assert.equal(published.length, 0, "a cancelled kick publishes nothing");
  db.close();
}

console.log("question sync kick test ok: fresh mint, idempotent re-poll, empty-observation skip, failed-read safety, and kick timing");

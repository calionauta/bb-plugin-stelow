import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  STALLED_ESCALATION_MS,
  escalatePausedSummary,
  upsertPausedEvent,
} from "../lib/inbox-events.mjs";
import { ensureInboxOccurrencesColumn } from "../lib/inbox-error-event.mjs";

/**
 * One stuck card is one action item, not a stream of identical rows.
 *
 * The paused event was keyed `paused:<card>:<idleAt>`, so every new idle
 * period minted a new row. A card blinking between idle and briefly-active
 * produced a stream of byte-identical notifications for one problem: a real
 * card carried EIGHT open rows all reading "Idle with unfinished work", and the
 * `Stalled Nd` escalation the inbox has for exactly this never fired once in the
 * whole database — its rows were buried under their own look-alikes.
 *
 * The badge counts unresolved action items. One stuck card is one of them.
 */

function memoryDb() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE inbox_events (
      id TEXT PRIMARY KEY,
      card_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      summary TEXT NOT NULL,
      dedupe_key TEXT NOT NULL UNIQUE,
      occurred_at INTEGER NOT NULL,
      read_at INTEGER,
      archived_at INTEGER,
      resolved_at INTEGER,
      resolved_reason TEXT,
      severity INTEGER NOT NULL DEFAULT 1,
      severity_reasons TEXT NOT NULL DEFAULT '[]',
      holder_card_id TEXT,
      holder_file TEXT
    );
    CREATE TABLE worker_ledger (card_id TEXT NOT NULL, stalled_count INTEGER NOT NULL DEFAULT 0);
  `);
  ensureInboxOccurrencesColumn(db);
  return db;
}

let seq = 0;
const createId = () => `evt_${++seq}`;
const MESSAGE = "Idle with unfinished work — retry continues in place, restart begins fresh.";

const rows = (db) =>
  db.prepare("SELECT summary, occurred_at, resolved_at FROM inbox_events WHERE kind = 'paused' ORDER BY occurred_at").all();

// The observed failure: eight idle periods, one card, one problem.
{
  const db = memoryDb();
  const start = 1_700_000_000_000;
  for (let hour = 0; hour < 8; hour += 1) {
    upsertPausedEvent(db, {
      cardId: "card_x",
      summary: MESSAGE,
      idleAt: start + hour * 3_600_000,
      nowMs: start + hour * 3_600_000,
      createId,
    });
  }
  const open = rows(db);
  assert.equal(open.length, 1, `eight idle periods on one card leave ONE open row, not eight (got ${open.length})`);
  assert.equal(open[0].summary, MESSAGE, "and it carries the reason the card is stuck");
  assert.equal(open[0].resolved_at, null, "still unresolved — the user has not acted on it");
}

// The row stays current, so a stale stall cannot hide at the bottom of the
// list by keeping its first timestamp.
{
  const db = memoryDb();
  const start = 1_700_000_000_000;
  upsertPausedEvent(db, { cardId: "c", summary: MESSAGE, idleAt: start, nowMs: start, createId });
  upsertPausedEvent(db, { cardId: "c", summary: MESSAGE, idleAt: start + 60_000, nowMs: start + 60_000, createId });
  assert.equal(rows(db)[0].occurred_at, start + 60_000, "a repeat idle refreshes the timestamp, so the item sorts as current");
}

// Age is measured from the FIRST idle, so a card idle for a week says seven
// days rather than resetting every time it blinks. Before this, escalation
// could never fire at all: every new row started its age at zero.
{
  const db = memoryDb();
  const start = 1_700_000_000_000;
  const fourDays = STALLED_ESCALATION_MS + 86_400_000;
  upsertPausedEvent(db, { cardId: "c", summary: MESSAGE, idleAt: start, nowMs: start, createId });
  upsertPausedEvent(db, { cardId: "c", summary: MESSAGE, idleAt: start + fourDays, nowMs: start + fourDays, createId });
  assert.match(
    rows(db)[0].summary,
    /^Stalled 4d — /,
    "past the escalation window the same row is reworded with the stall age, instead of a new row appearing",
  );
  assert.equal(rows(db).length, 1, "and it is still one row — escalation happens in place");
}

// The age prefix must not stack: a refreshed row keeps one prefix, not "Stalled
// 4d — Stalled 5d — ...".
{
  const db = memoryDb();
  const start = 1_700_000_000_000;
  const at = start + STALLED_ESCALATION_MS + 10 * 86_400_000;
  upsertPausedEvent(db, { cardId: "c", summary: MESSAGE, idleAt: start, nowMs: start, createId });
  upsertPausedEvent(db, { cardId: "c", summary: MESSAGE, idleAt: at, nowMs: at, createId });
  assert.equal(
    (rows(db)[0].summary.match(/Stalled \d+d — /g) ?? []).length,
    1,
    "the stall prefix is replaced, never accumulated",
  );
}

// Resolution is what re-opens the count: once the user acts, the next stall is
// a new item.
{
  const db = memoryDb();
  const start = 1_700_000_000_000;
  upsertPausedEvent(db, { cardId: "c", summary: MESSAGE, idleAt: start, nowMs: start, createId });
  db.prepare("UPDATE inbox_events SET resolved_at = ? WHERE resolved_at IS NULL").run(start + 1000);
  upsertPausedEvent(db, { cardId: "c", summary: MESSAGE, idleAt: start + 2000, nowMs: start + 2000, createId });
  const all = db.prepare("SELECT resolved_at FROM inbox_events WHERE kind = 'paused'").all();
  assert.equal(all.length, 2, "after the user acts, the next stall is a new item");
  assert.equal(all.filter((row) => row.resolved_at === null).length, 1, "and exactly one is open");
}

// Different cards are independent — this is not a global de-duplication.
{
  const db = memoryDb();
  const now = 1_700_000_000_000;
  upsertPausedEvent(db, { cardId: "a", summary: MESSAGE, idleAt: now, nowMs: now, createId });
  upsertPausedEvent(db, { cardId: "b", summary: MESSAGE, idleAt: now, nowMs: now, createId });
  assert.equal(rows(db).length, 2, "two stuck cards are two action items — one row each");
}

// The age helper the row reword uses is unchanged and still exact.
assert.equal(escalatePausedSummary(MESSAGE, 0), `Stalled 0d — ${MESSAGE}`);
assert.equal(escalatePausedSummary(`Stalled 3d — ${MESSAGE}`, 5 * 86_400_000), `Stalled 5d — ${MESSAGE}`, "re-escalating replaces the old prefix");

console.log("inbox paused upsert test ok: one stuck card is one open row, escalated in place");

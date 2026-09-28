import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { ensureInboxResolvedReasonColumn } from "../lib/inbox-events.mjs";
import { reactivateRestorePending } from "../lib/card-restore-pending.mjs";

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
`);
ensureInboxResolvedReasonColumn(db);

const insert = db.prepare(
  "INSERT INTO inbox_events (id, card_id, kind, summary, dedupe_key, occurred_at, resolved_at, resolved_reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
);
const row = (id) => db.prepare("SELECT resolved_at, resolved_reason, summary FROM inbox_events WHERE id = ?").get(id);

db.prepare("INSERT INTO cards VALUES (?, ?, ?, ?, ?)").run("card_1", "Restore me", "restore-me", "project_1", "build");
db.prepare("INSERT INTO cards VALUES (?, ?, ?, ?, ?)").run("card_2", "Untouched", "untouched", "project_1", "build");

// Rows the archive took away: open at archive time, resolved as archived.
insert.run("evt_q", "card_1", "question", "Choose one.", "question:card_1:ask_1", 100, 200, "archived");
insert.run("evt_e", "card_1", "error", "Provider error 400: Internal server error", "error:card_1:101", 101, 200, "archived");
insert.run("evt_p", "card_1", "paused", "Paused.", "paused:card_1:102", 102, 200, "archived");
insert.run("evt_c", "card_1", "completed", "Build complete.", "completed:card_1:103", 103, null, null);
// A completion the archive hypothetically resolved: restore must still not
// touch it — the card is not completing again, and deliveries clear by read.
insert.run("evt_c2", "card_1", "completed", "Old delivery.", "completed:card_1:104", 104, 200, "archived");
// Rows resolved before the archive for genuine reasons: restore must not touch.
insert.run("evt_q_old", "card_1", "question", "Old Q.", "question:card_1:ask_0", 50, 150, "answered");
insert.run("evt_e_old", "card_1", "error", "Old E.", "error:card_1:51", 51, 150, "resumed");
// Another card's archived rows: restore is per-card.
insert.run("evt_q_other", "card_2", "question", "Other Q.", "question:card_2:ask_9", 100, 200, "archived");

const result = reactivateRestorePending(db, {
  cardId: "card_1",
  lastError: "Provider error 400: Internal server error",
  occurredAt: 300,
});
assert.deepEqual(
  result,
  { questionsReopened: 1, errorsReopened: 1, pausedReopened: 0, completedReopened: 0 },
  "restore reactivates per kind: question and error return, paused re-derives, completed stays",
);

assert.deepEqual(
  row("evt_q"),
  { resolved_at: null, resolved_reason: null, summary: "Choose one." },
  "a returned question is open with no stale answered label",
);
assert.deepEqual(
  row("evt_e"),
  { resolved_at: null, resolved_reason: null, summary: "Provider error 400: Internal server error" },
  "a returned error carries the stored last_error verbatim, not a paraphrase",
);
assert.deepEqual(
  row("evt_p").resolved_at,
  200,
  "an archived paused row stays resolved here; the running worker re-derives it from live state",
);
assert.deepEqual(
  row("evt_c"),
  { resolved_at: null, resolved_reason: null, summary: "Build complete." },
  "the completion delivery is untouched: the card is not completing again",
);
assert.deepEqual(
  row("evt_c2"),
  { resolved_at: 200, resolved_reason: "archived", summary: "Old delivery." },
  "even an archive-resolved completion stays resolved: deliveries clear by read",
);
assert.deepEqual(
  row("evt_q_old"),
  { resolved_at: 150, resolved_reason: "answered", summary: "Old Q." },
  "a question answered before the archive stays answered",
);
assert.deepEqual(row("evt_e_old"), { resolved_at: 150, resolved_reason: "resumed", summary: "Old E." }, "an error resumed before the archive stays resumed");
assert.deepEqual(
  row("evt_q_other"),
  { resolved_at: 200, resolved_reason: "archived", summary: "Other Q." },
  "no other card's badge item moves",
);

assert.throws(
  () => reactivateRestorePending(db, { occurredAt: 300 }),
  /cardId/,
  "a missing card id fails fast instead of reopening the whole table",
);
assert.throws(
  () => reactivateRestorePending(db, { cardId: "card_1" }),
  /occurredAt/,
  "a missing timestamp fails fast",
);

console.log("card-restore-pending: per-kind reactivation holds.");

import assert from "node:assert/strict";
import Database from "better-sqlite3";
import {
  ensureInboxResolvedReasonColumn, hasPendingReview, insertInboxEvent, listInboxEvents,
  markQuestionsAnswered, resolveActionInboxEvents, resolveAllInboxEvents, syncQuestionInboxEvents,
  countsForInboxBadge, STALLED_ESCALATION_MS, escalatePausedSummary, refreshStalledPaused, stalledDays,
} from "../lib/inbox-events.mjs";
import { ensureInboxOccurrencesColumn } from "../lib/inbox-error-event.mjs";
import { inboxFilterEntries } from "../lib/inbox-event-presentation.mjs";

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
ensureInboxOccurrencesColumn(db);
db.prepare("INSERT INTO cards VALUES (?, ?, ?, ?, ?)").run("card_1", "Launch Inbox", "launch-inbox", "project_1", "build");

const paused = { id: "evt_paused", cardId: "card_1", kind: "paused", summary: "Paused.", dedupeKey: "paused:card_1:100", occurredAt: 100 };
assert.equal(insertInboxEvent(db, paused), true, "first lifecycle event is durable");
assert.equal(insertInboxEvent(db, { ...paused, id: "evt_duplicate" }), false, "repeated lifecycle polling cannot create duplicate alerts");
assert.equal(listInboxEvents(db, false).length, 1, "unresolved action is visible in Inbox");

assert.equal(resolveActionInboxEvents(db, "card_1", 200), 1, "resuming work resolves the pending action");
assert.equal(listInboxEvents(db, false).length, 1, "resolved action stays queryable for the Resolved history");
assert.equal(listInboxEvents(db, false)[0].resolved_at, 200, "resolution timestamp is durable");
assert.equal(listInboxEvents(db, false)[0].resolved_reason, null, "a reason-less resolution stays reason-less for legacy rows");

const completed = { id: "evt_completed", cardId: "card_1", kind: "completed", summary: "Completed.", dedupeKey: "completed:card_1:300", occurredAt: 300 };
assert.equal(insertInboxEvent(db, completed), true);
assert.equal(listInboxEvents(db, false)[0].id, "evt_completed", "completion remains a recent update after action resolution");

// Review signal: a completion nobody has opened yet. It is NOT the action
// badge (a finished card is not blocked work), so this stays true while
// countsForInboxBadge carries the same review request to the sidebar.
assert.equal(hasPendingReview(db, "card_1"), true, "an unopened completion asks for review");
assert.equal(countsForInboxBadge({ kind: "completed", archivedAt: null, resolvedAt: null, readAt: null, occurredAt: 300 }), true, "the same completion reaches the attention badge until opened");
assert.equal(hasPendingReview(db, "card_absent"), false, "a card with no completion has nothing to review");

db.prepare("UPDATE inbox_events SET archived_at = ? WHERE id = ?").run(400, "evt_completed");
assert.equal(listInboxEvents(db, false).length, 1, "only archived events are hidden; resolved history remains");
assert.equal(listInboxEvents(db, true).length, 2, "archive view retains the full durable history");
assert.equal(db.prepare("UPDATE inbox_events SET read_at = ? WHERE id = ? AND read_at IS NULL").run(401, "evt_completed").changes, 1, "read acknowledgement persists");
assert.equal(db.prepare("UPDATE inbox_events SET read_at = ? WHERE id = ? AND read_at IS NULL").run(402, "evt_completed").changes, 0, "read acknowledgement is idempotent");
assert.equal(hasPendingReview(db, "card_1"), false, "opening the Done card clears the review signal");
assert.equal(db.prepare("UPDATE inbox_events SET archived_at = NULL WHERE id = ? AND archived_at IS NOT NULL").run("evt_completed").changes, 1, "archived notification can be restored");
assert.equal(listInboxEvents(db, false)[0].id, "evt_completed", "restored completion returns to recent updates");

// Per-kind resolution: resuming work clears failure/pause signals but a
// question stays until it is answered.
db.prepare("INSERT INTO cards VALUES (?, ?, ?, ?, ?)").run("card_2", "Per-kind", "per-kind", "project_1", "build");
insertInboxEvent(db, { id: "evt_q", cardId: "card_2", kind: "question", summary: "Q?", dedupeKey: "question:card_2:500", occurredAt: 500 });
insertInboxEvent(db, { id: "evt_e", cardId: "card_2", kind: "error", summary: "E!", dedupeKey: "error:card_2:501", occurredAt: 501 });
assert.equal(resolveActionInboxEvents(db, "card_2", 600, ["error", "paused"]), 1, "resume resolves error and paused only");
const card2rows = listInboxEvents(db, false).filter((row) => row.card_id === "card_2");
assert.equal(card2rows.length, 2, "both rows stay listed (action + resolved history)");
assert.equal(card2rows.find((row) => row.id === "evt_q").resolved_at, null, "question stays unresolved after a bare resume");
assert.equal(resolveActionInboxEvents(db, "card_2", 601, ["question"]), 1, "answering resolves the question");
assert.equal(resolveActionInboxEvents(db, "card_2", 602, ["bogus"]), 0, "unknown kinds resolve nothing");
assert.equal(resolveActionInboxEvents(db, "card_2", 603, []), 0, "empty kind list resolves nothing");
// Resolution reasons travel with the timestamp: resume names resumed,
// completion names completed, archive names archived.
assert.equal(resolveActionInboxEvents(db, "card_2", 604, ["error", "paused"], "resumed"), 0, "already-resolved rows are untouched by a second pass");
db.prepare("INSERT INTO cards VALUES (?, ?, ?, ?, ?)").run("card_2b", "Reasons", "reasons", "project_1", "build");
insertInboxEvent(db, { id: "evt_r", cardId: "card_2b", kind: "paused", summary: "P.", dedupeKey: "paused:card_2b:1", occurredAt: 1 });
assert.equal(resolveActionInboxEvents(db, "card_2b", 2, ["paused"], "resumed"), 1, "resume records its reason");
assert.equal(db.prepare("SELECT resolved_reason FROM inbox_events WHERE id = ?").get("evt_r").resolved_reason, "resumed", "the Resolved filter can name how it cleared");
assert.equal(resolveActionInboxEvents(db, "card_2b", 3, ["paused"], "completed"), 0, "a later reason never overwrites the first");
assert.equal(resolveActionInboxEvents(db, "card_2b", 3, ["paused"], "bogus-reason"), 0, "unknown reasons resolve nothing new and overwrite nothing");

// A question's interaction id is stable across polls. Timestamp-derived keys
// would have created a duplicate notification every time a worker briefly
// reported running between two reads of the same pending question.
db.prepare("INSERT INTO cards VALUES (?, ?, ?, ?, ?)").run("card_3", "Stable question", "stable-question", "project_1", "build");
const questionSummary = "The agent is waiting for your answer to continue.";
insertInboxEvent(db, { id: "evt_paused_for_question", cardId: "card_3", kind: "paused", summary: "Resume.", dedupeKey: "paused:card_3:699", occurredAt: 699 });
syncQuestionInboxEvents(db, { cardId: "card_3", interactionIds: ["ask_1"], occurredAt: 700, createId: () => "evt_ask_1", summary: questionSummary });
const supersededPause = db.prepare("SELECT resolved_at, resolved_reason FROM inbox_events WHERE id = ?").get("evt_paused_for_question");
assert.deepEqual(supersededPause, { resolved_at: 700, resolved_reason: "superseded" }, "a visible question replaces an ambiguous pause instead of creating a second attention count");
insertInboxEvent(db, { id: "evt_error_for_question", cardId: "card_3", kind: "error", summary: "Provider error 400.", dedupeKey: "error:card_3:740", occurredAt: 740 });
syncQuestionInboxEvents(db, { cardId: "card_3", interactionIds: ["ask_1"], occurredAt: 745, createId: () => "evt_ask_1_dup", summary: questionSummary });
const supersededError = db.prepare("SELECT resolved_at, resolved_reason FROM inbox_events WHERE id = ?").get("evt_error_for_question");
assert.deepEqual(supersededError, { resolved_at: 745, resolved_reason: "superseded" }, "a visible question also absorbs a concurrent error instead of double-counting one card");
syncQuestionInboxEvents(db, { cardId: "card_3", interactionIds: ["ask_1"], occurredAt: 735, createId: () => "evt_ask_1_retry", summary: questionSummary });
let card3Questions = db.prepare("SELECT * FROM inbox_events WHERE card_id = ? AND kind = 'question'").all("card_3");
assert.equal(card3Questions.length, 1, "the same pending interaction creates one durable notification");
assert.equal(card3Questions[0].resolved_at, null, "the active interaction remains actionable");
syncQuestionInboxEvents(db, { cardId: "card_3", interactionIds: ["ask_2"], occurredAt: 800, createId: () => "evt_ask_2", summary: questionSummary });
card3Questions = db.prepare("SELECT * FROM inbox_events WHERE card_id = ? AND kind = 'question' ORDER BY occurred_at").all("card_3");
assert.equal(card3Questions.length, 2, "a genuinely new interaction gets its own notification");
assert.equal(card3Questions[0].resolved_at, 800, "superseded question notifications are resolved");
assert.equal(card3Questions[1].resolved_at, null, "the replacement interaction stays actionable");
db.prepare("UPDATE inbox_events SET resolved_at = ? WHERE id = ?").run(850, "evt_ask_2");
syncQuestionInboxEvents(db, { cardId: "card_3", interactionIds: ["ask_2"], occurredAt: 860, createId: () => "evt_ask_2_again", summary: questionSummary });
assert.equal(db.prepare("SELECT resolved_at FROM inbox_events WHERE id = ?").get("evt_ask_2").resolved_at, null, "a still-pending interaction reopens its resolved notification");
syncQuestionInboxEvents(db, { cardId: "card_3", interactionIds: [], occurredAt: 900, createId: () => "unused", summary: questionSummary });
assert.equal(db.prepare("SELECT COUNT(*) AS count FROM inbox_events WHERE card_id = ? AND kind = 'question' AND resolved_at IS NULL").get("card_3").count, 0, "no pending interaction resolves all question notifications");
// An answered question keeps its reason even though disappearance alone
// would have called it superseded: mark first, sync second.
db.prepare("INSERT INTO cards VALUES (?, ?, ?, ?, ?)").run("card_4", "Answered", "answered", "project_1", "build");
syncQuestionInboxEvents(db, { cardId: "card_4", interactionIds: ["ask_9"], occurredAt: 1000, createId: () => "evt_ask_9", summary: questionSummary });
assert.equal(markQuestionsAnswered(db, { cardId: "card_4", interactionIds: ["ask_9"], occurredAt: 1010 }), 1, "answering marks the open question");
syncQuestionInboxEvents(db, { cardId: "card_4", interactionIds: [], occurredAt: 1020, createId: () => "unused", summary: questionSummary });
assert.equal(db.prepare("SELECT resolved_reason FROM inbox_events WHERE id = ?").get("evt_ask_9").resolved_reason, "answered", "the sync never relabels an answer as superseded");
assert.equal(db.prepare("SELECT resolved_reason FROM inbox_events WHERE id = ?").get("evt_ask_1").resolved_reason, "superseded", "a withdrawn question reads as superseded");
assert.equal(markQuestionsAnswered(db, { cardId: "card_4", interactionIds: [], occurredAt: 1030 }), 0, "empty answer batch marks nothing");
db.prepare("DELETE FROM cards WHERE id = ?").run("card_4");

// One batch, one notification: a timed-out batched ask persists as one
// expired row per sub-question sharing expired_at. Without batch keys the
// inbox minted one notification per row and the badge counted one decision
// several times over (card_a9q5zhzd: Keep IN + Add to IN as two identical
// rows). Live interactions keep per-id keys; a new expired_at still earns
// its own row.
db.exec(`
  CREATE TABLE expired_questions (
    id TEXT PRIMARY KEY, card_id TEXT NOT NULL, thread_id TEXT NOT NULL,
    question TEXT NOT NULL, expired_at INTEGER NOT NULL, answered INTEGER NOT NULL DEFAULT 0
  );
`);
db.prepare("INSERT INTO cards VALUES (?, ?, ?, ?, ?)").run("card_5", "Batch", "batch", "project_1", "build");
const expireBatch = (rows) => {
  const insert = db.prepare(
    "INSERT INTO expired_questions (id, card_id, thread_id, question, expired_at, answered) VALUES (?, 'card_5', 'thr_5', ?, ?, 0)",
  );
  for (const row of rows) insert.run(row.id, row.question, row.at);
};
let batchSerial = 0;
const syncBatch = (ids, at) => syncQuestionInboxEvents(db, {
  cardId: "card_5", interactionIds: ids, occurredAt: at, createId: () => `evt_batch_${batchSerial += 1}`, summary: questionSummary,
});
const openBatchRows = () => db.prepare(
  "SELECT dedupe_key, resolved_at, resolved_reason FROM inbox_events "
  + "WHERE card_id = 'card_5' AND kind = 'question' ORDER BY occurred_at",
).all();
const openBatchCount = () => openBatchRows().filter((row) => row.resolved_at === null).length;
// An unknown expired id notifies nothing: no row, no batch, no phantom.
// Placed before the first batch exists, so the empty key set resolves nothing.
assert.equal(syncBatch(["expired:ghost"], 900).inserted, 0, "a stale expired id invents no attention");
assert.equal(openBatchRows().length, 0, "and leaves no row behind");
expireBatch([{ id: "qexp_a1", question: "Keep IN?", at: 1000 }, { id: "qexp_a2", question: "Add to IN?", at: 1000 }]);
assert.equal(syncBatch(["expired:qexp_a1", "expired:qexp_a2"], 1100).inserted, 1, "one timed-out batch mints one notification, not one per sub-question");
assert.equal(openBatchRows().length, 1, "the badge counts one decision moment once");
assert.equal(openBatchRows()[0].dedupe_key, "question:card_5:expired:1000", "the batch shares one event key");
assert.equal(syncBatch(["expired:qexp_a1", "expired:qexp_a2"], 1200).inserted, 0, "re-polling the batch inserts no duplicate");
expireBatch([{ id: "qexp_b1", question: "Later?", at: 2000 }]);
syncBatch(["expired:qexp_a1", "expired:qexp_a2", "expired:qexp_b1"], 2100);
assert.equal(openBatchCount(), 2, "a genuinely new batch earns its own notification");
syncBatch(["pint_live", "expired:qexp_a1", "expired:qexp_a2", "expired:qexp_b1"], 2200);
assert.equal(openBatchCount(), 3, "a live interaction keeps its own row beside the batches");
// The expired answer flow commits answered=1 BEFORE marking: the mapping
// must still find the rows, or the reason degrades to superseded.
db.prepare("UPDATE expired_questions SET answered = 1 WHERE id IN ('qexp_a1', 'qexp_a2')").run();
const batchMarked = markQuestionsAnswered(db, {
  cardId: "card_5", interactionIds: ["expired:qexp_a1", "expired:qexp_a2"], occurredAt: 2300,
});
assert.equal(batchMarked, 1, "answering marks the batch");
assert.equal(openBatchRows()[0].resolved_reason, "answered", "a human answer keeps its reason");
// A resolved batch reopens while its questions are still open: resolve the
// row, then sync the same expired ids and the same key comes back open.
db.prepare("UPDATE inbox_events SET resolved_at = 100, resolved_reason = 'superseded' WHERE card_id = 'card_5'").run();
syncBatch(["expired:qexp_b1", "pint_live"], 2400);
const reopened = openBatchRows().filter((row) => row.resolved_at === null);
assert.equal(reopened.length, 2, "open batches and live asks reopen their rows");
assert.ok(reopened.some((row) => row.dedupe_key === "question:card_5:expired:2000"), "the batch key, not a per-id row, is what reopens");
// Legacy per-id rows from before batch keys self-heal: the next sync with
// the batch set supersedes the look-alike while the batch row stays open.
db.prepare(
  "INSERT INTO inbox_events (id, card_id, kind, summary, dedupe_key, occurred_at) "
  + "VALUES ('evt_legacy', 'card_5', 'question', ?, 'question:card_5:expired:qexp_b1', 1500)",
).run(questionSummary);
syncBatch(["expired:qexp_b1", "pint_live"], 2600);
assert.equal(
  db.prepare("SELECT resolved_reason FROM inbox_events WHERE id = 'evt_legacy'").get().resolved_reason,
  "superseded",
  "the pre-batch per-id row resolves once the batch key owns the moment",
);
assert.ok(
  openBatchRows().some((row) => row.dedupe_key === "question:card_5:expired:2000" && row.resolved_at === null),
  "while the batch notification itself stays actionable",
);
db.prepare("DELETE FROM cards WHERE id = ?").run("card_5");

db.prepare("DELETE FROM cards WHERE id = ?").run("card_2");
db.prepare("DELETE FROM cards WHERE id = ?").run("card_2b");
db.prepare("DELETE FROM cards WHERE id = ?").run("card_3");
db.prepare("DELETE FROM cards WHERE id = ?").run("card_1");
assert.equal(db.prepare("SELECT COUNT(*) AS count FROM inbox_events").get().count, 0, "deleting a card cascades to its Inbox history");

// Badge rule: unresolved actions count whether or not the user has already
// read them; an unread completion counts until its review is acknowledged.
const NOW = 1_000_000_000;
const action = { kind: "question", archivedAt: null, resolvedAt: null, readAt: NOW, occurredAt: NOW - 30 * 86_400_000 };
assert.equal(countsForInboxBadge(action, NOW), true, "unresolved action counts even when read and old");
assert.equal(countsForInboxBadge({ ...action, resolvedAt: NOW }, NOW), false, "resolved action stops counting");
assert.equal(countsForInboxBadge({ ...action, archivedAt: NOW }, NOW), false, "archived action stops counting");
const completedBadgeEvent = { kind: "completed", archivedAt: null, resolvedAt: null, readAt: null, occurredAt: NOW };
assert.equal(countsForInboxBadge(completedBadgeEvent, NOW), true, "an unread completion reaches the review badge");

// Inbox filters distinguish attention work from durable history. A resolved
// question may have followed a human answer, so the filter is lifecycle-based,
// not proof that automation answered it.
const filteredEvents = [
  { kind: "question", archivedAt: null, resolvedAt: null, readAt: 1 },
  { kind: "error", archivedAt: null, resolvedAt: 1, readAt: 1 },
  { kind: "completed", archivedAt: null, resolvedAt: null, readAt: null },
  { kind: "paused", archivedAt: 1, resolvedAt: null, readAt: null },
];
assert.equal(inboxFilterEntries(filteredEvents, "attention").length, 2, "Needs attention contains unresolved work and unread review requests");
assert.equal(inboxFilterEntries(filteredEvents, "attention").length, filteredEvents.filter((event) => countsForInboxBadge(event)).length, "the primary Inbox list and sidebar badge use the same action set");
assert.equal(inboxFilterEntries(filteredEvents, "resolved").length, 1, "Resolved history contains no-longer-actionable work");
assert.equal(inboxFilterEntries(filteredEvents, "read").length, 2, "Read holds updates already seen, and only those");
assert.equal(inboxFilterEntries(filteredEvents, "all").length, 3, "All contains every non-archived update including completions");

db.close();

const olderDb = new Database(":memory:");
olderDb.exec("CREATE TABLE inbox_events (id TEXT PRIMARY KEY, card_id TEXT NOT NULL, kind TEXT NOT NULL, summary TEXT NOT NULL, dedupe_key TEXT NOT NULL UNIQUE, occurred_at INTEGER NOT NULL, read_at INTEGER, archived_at INTEGER)");
const olderColumns = olderDb.prepare("PRAGMA table_info(inbox_events)").all();
if (!olderColumns.some((column) => column.name === "resolved_at")) olderDb.exec("ALTER TABLE inbox_events ADD COLUMN resolved_at INTEGER");
assert.ok(olderDb.prepare("PRAGMA table_info(inbox_events)").all().some((column) => column.name === "resolved_at"), "an Inbox database without the column gains it safely");
ensureInboxResolvedReasonColumn(olderDb);
assert.ok(olderDb.prepare("PRAGMA table_info(inbox_events)").all().some((column) => column.name === "resolved_reason"), "a pre-reason database gains the reason column without losing rows");
ensureInboxResolvedReasonColumn(olderDb);
assert.ok(olderDb.prepare("PRAGMA table_info(inbox_events)").all().filter((column) => column.name === "resolved_reason").length === 1, "the migration is idempotent");
olderDb.close();

// Stalled-paused escalation: an open paused event older than the second
// window gets its summary reworded with the age — same row, same count,
// same resolution rules. Fresh pauses, resolved pauses, and other kinds
// are untouched; re-running is a no-op (idempotent by content).

assert.equal(STALLED_ESCALATION_MS, 3 * 24 * 3600 * 1000, "escalation waits days, not minutes");
assert.equal(stalledDays(2 * 86400000), 2, "whole days floor");
assert.equal(stalledDays(-5), 0, "negative idle never goes below zero");
assert.equal(
  escalatePausedSummary("Idle with unfinished work.", 4 * 86400000),
  "Stalled 4d — Idle with unfinished work.",
  "the age prefixes the original copy",
);
assert.equal(
  escalatePausedSummary("Stalled 3d — Idle with unfinished work.", 5 * 86400000),
  "Stalled 5d — Idle with unfinished work.",
  "re-escalation refreshes the age instead of stacking prefixes",
);

const staleDb = new Database(":memory:");
staleDb.exec(`
  CREATE TABLE cards (id TEXT PRIMARY KEY, display_name TEXT, name TEXT NOT NULL, project_id TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'build');
  CREATE TABLE inbox_events (
    id TEXT PRIMARY KEY, card_id TEXT NOT NULL, kind TEXT NOT NULL,
    summary TEXT NOT NULL, dedupe_key TEXT NOT NULL UNIQUE, occurred_at INTEGER NOT NULL,
    read_at INTEGER, archived_at INTEGER, resolved_at INTEGER
  );
`);
staleDb.prepare("INSERT INTO cards VALUES (?, ?, ?, ?, ?)").run("card_9", "Stalled", "stalled", "project_1", "build");
const nowMs = 1_000_000_000_000;
staleDb.prepare("INSERT INTO inbox_events VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
  "evt_old", "card_9", "paused", "Idle with unfinished work.", "paused:card_9:1", 1, null, null, null,
);
staleDb.prepare("INSERT INTO inbox_events VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
  "evt_fresh", "card_9", "paused", "Idle with unfinished work.", "paused:card_9:2", nowMs - 1000, null, null, null,
);
staleDb.prepare("INSERT INTO inbox_events VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
  "evt_done", "card_9", "paused", "Idle with unfinished work.", "paused:card_9:3", 1, null, null, nowMs,
);
assert.equal(refreshStalledPaused(staleDb, { cardId: "card_9", nowMs }), 1, "only the old open paused event escalates");
const escalated = staleDb.prepare("SELECT summary FROM inbox_events WHERE id = ?").get("evt_old").summary;
assert.ok(escalated.startsWith("Stalled "), "the old event carries its age");
assert.equal(staleDb.prepare("SELECT summary FROM inbox_events WHERE id = ?").get("evt_fresh").summary, "Idle with unfinished work.", "a fresh pause keeps its copy");
assert.equal(refreshStalledPaused(staleDb, { cardId: "card_9", nowMs }), 0, "re-running without new aging changes nothing");
assert.equal(refreshStalledPaused(staleDb, { cardId: "card_absent", nowMs }), 0, "unknown cards escalate nothing");
staleDb.close();
// Archiving is terminal for a card, so it must close the review request too.
// An archived card is off the board and its worker is stopped: an open
// `completed` row is a notification asking someone to go look at work that is
// no longer reachable from anywhere, and the badge would count it forever.
const archiveDb = new Database(":memory:");
archiveDb.exec(`
  CREATE TABLE cards (id TEXT PRIMARY KEY, display_name TEXT, name TEXT NOT NULL, project_id TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'build');
  CREATE TABLE inbox_events (
    id TEXT PRIMARY KEY, card_id TEXT NOT NULL, kind TEXT NOT NULL,
    summary TEXT NOT NULL, dedupe_key TEXT NOT NULL UNIQUE, occurred_at INTEGER NOT NULL,
    read_at INTEGER, archived_at INTEGER, resolved_at INTEGER,
    resolved_reason TEXT,
    severity INTEGER NOT NULL DEFAULT 1, severity_reasons TEXT NOT NULL DEFAULT '[]',
    holder_card_id TEXT, holder_file TEXT,
    FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE
  );
`);
ensureInboxResolvedReasonColumn(archiveDb);
ensureInboxOccurrencesColumn(archiveDb);
archiveDb.prepare("INSERT INTO cards VALUES (?, ?, ?, ?, ?)").run("card_arc", "Archived", "archived", "project_1", "build");
insertInboxEvent(archiveDb, { id: "evt_arc_q", cardId: "card_arc", kind: "question", summary: "Q?", dedupeKey: "question:card_arc:1", occurredAt: 1 });
insertInboxEvent(archiveDb, { id: "evt_arc_e", cardId: "card_arc", kind: "error", summary: "E!", dedupeKey: "error:card_arc:2", occurredAt: 2 });
insertInboxEvent(archiveDb, { id: "evt_arc_c", cardId: "card_arc", kind: "completed", summary: "Done.", dedupeKey: "completed:card_arc:3", occurredAt: 3 });

assert.equal(hasPendingReview(archiveDb, "card_arc"), true, "an unopened completion asks for review");
assert.equal(
  resolveAllInboxEvents(archiveDb, "card_arc", 10, "archived"),
  3,
  "archiving closes every open row, completions included",
);
assert.equal(hasPendingReview(archiveDb, "card_arc"), false, "an archived card cannot keep asking for a review");
const archivedRows = archiveDb.prepare("SELECT id, resolved_at, resolved_reason, read_at FROM inbox_events WHERE card_id = ? ORDER BY id").all("card_arc");
assert.equal(archivedRows.length, 3, "archiving resolves; it never deletes the history");
assert.deepEqual(
  archivedRows.map((row) => row.resolved_reason),
  ["archived", "archived", "archived"],
  "every kind records why it closed, so Resolved can name it per row",
);
assert.deepEqual(
  archivedRows.map((row) => row.read_at),
  [null, null, null],
  "archiving is not a read: nobody is recorded as having reviewed work they never saw",
);
assert.equal(
  resolveAllInboxEvents(archiveDb, "card_arc", 20, "archived"),
  0,
  "re-archiving changes nothing, and never rewrites an existing resolution",
);
assert.equal(
  archiveDb.prepare("SELECT resolved_at FROM inbox_events WHERE id = ?").get("evt_arc_c").resolved_at,
  10,
  "the first resolution timestamp is the one that stands",
);
assert.equal(resolveAllInboxEvents(archiveDb, "card_absent", 30, "archived"), 0, "an unknown card closes nothing");
assert.equal(
  resolveAllInboxEvents(archiveDb, "card_arc", 40, null),
  0,
  "a reason-less terminal resolution is allowed but still resolves nothing twice",
);
archiveDb.close();

console.log("inbox flows test ok: dedupe, resolve, completion, archive, terminal-resolves-completions, history visibility, and stalled escalation");

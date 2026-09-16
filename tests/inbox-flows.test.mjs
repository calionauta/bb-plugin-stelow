import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { ensureInboxResolvedReasonColumn, hasPendingReview, insertInboxEvent, listInboxEvents, markQuestionsAnswered, resolveActionInboxEvents, syncQuestionInboxEvents, countsForInboxBadge } from "../lib/inbox-events.mjs";
import { inboxFilterEntries } from "../lib/inbox-event-presentation.mjs";

const db = new Database(":memory:");
db.exec(`
  PRAGMA foreign_keys = ON;
  CREATE TABLE cards (id TEXT PRIMARY KEY, display_name TEXT, name TEXT NOT NULL, project_id TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'build');
  CREATE TABLE inbox_events (
    id TEXT PRIMARY KEY, card_id TEXT NOT NULL, kind TEXT NOT NULL,
    summary TEXT NOT NULL, dedupe_key TEXT NOT NULL UNIQUE, occurred_at INTEGER NOT NULL,
    read_at INTEGER, archived_at INTEGER, resolved_at INTEGER,
    FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE
  );
`);
ensureInboxResolvedReasonColumn(db);
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
// countsForInboxBadge stays false for the same row.
assert.equal(hasPendingReview(db, "card_1"), true, "an unopened completion asks for review");
assert.equal(countsForInboxBadge({ kind: "completed", archivedAt: null, resolvedAt: null, readAt: null, occurredAt: 300 }), false, "the same completion never inflates the action badge");
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

db.prepare("DELETE FROM cards WHERE id = ?").run("card_2");
db.prepare("DELETE FROM cards WHERE id = ?").run("card_2b");
db.prepare("DELETE FROM cards WHERE id = ?").run("card_3");
db.prepare("DELETE FROM cards WHERE id = ?").run("card_1");
assert.equal(db.prepare("SELECT COUNT(*) AS count FROM inbox_events").get().count, 0, "deleting a card cascades to its Inbox history");

// Badge rule: unresolved actions count whether or not the user has already
// read them; completion is history and never inflates the action badge.
const NOW = 1_000_000_000;
const action = { kind: "question", archivedAt: null, resolvedAt: null, readAt: NOW, occurredAt: NOW - 30 * 86_400_000 };
assert.equal(countsForInboxBadge(action, NOW), true, "unresolved action counts even when read and old");
assert.equal(countsForInboxBadge({ ...action, resolvedAt: NOW }, NOW), false, "resolved action stops counting");
assert.equal(countsForInboxBadge({ ...action, archivedAt: NOW }, NOW), false, "archived action stops counting");
const completedBadgeEvent = { kind: "completed", archivedAt: null, resolvedAt: null, readAt: null, occurredAt: NOW };
assert.equal(countsForInboxBadge(completedBadgeEvent, NOW), false, "a completion stays in history instead of inflating the action badge");

// Inbox filters distinguish attention work from durable history. A resolved
// question may have followed a human answer, so the filter is lifecycle-based,
// not proof that automation answered it.
const filteredEvents = [
  { kind: "question", archivedAt: null, resolvedAt: null, readAt: 1 },
  { kind: "error", archivedAt: null, resolvedAt: 1, readAt: 1 },
  { kind: "completed", archivedAt: null, resolvedAt: null, readAt: null },
  { kind: "paused", archivedAt: 1, resolvedAt: null, readAt: null },
];
assert.equal(inboxFilterEntries(filteredEvents, "attention").length, 1, "Needs attention contains unresolved work even after it has been read");
assert.equal(inboxFilterEntries(filteredEvents, "attention").length, filteredEvents.filter((event) => countsForInboxBadge(event)).length, "the primary Inbox list and sidebar badge use the same action set");
assert.equal(inboxFilterEntries(filteredEvents, "resolved").length, 1, "Resolved history contains no-longer-actionable work");
assert.equal(inboxFilterEntries(filteredEvents, "archived").length, 1, "Archived filter retains archived events");
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
console.log("inbox flows test ok: dedupe, resolve, completion, archive, and history visibility");

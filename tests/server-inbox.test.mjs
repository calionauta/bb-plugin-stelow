import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { createInboxServer, runInboxMigrations } from "../server/inbox.ts";
import { hasPendingReview } from "../lib/inbox-events.mjs";

function createDb() {
  const db = new Database(":memory:");
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE cards (
      id TEXT PRIMARY KEY,
      display_name TEXT,
      name TEXT NOT NULL,
      project_id TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'build'
    );
  `);
  runInboxMigrations(db);
  runInboxMigrations(db);
  return db;
}

const db = createDb();
const now = { value: 1_000 };
const published = [];
let id = 0;
const inbox = createInboxServer({
  db,
  now: () => now.value,
  randomId: (prefix) => `${prefix}_${++id}`,
  publish: (event, payload) => published.push({ event, payload }),
  listProjects: async () => [{ id: "project_1", name: "Project One" }],
});
const { handlers } = inbox;

db.prepare(`
  INSERT INTO cards (id, display_name, name, project_id, kind)
  VALUES ('card_1', 'Shown name', 'card-one', 'project_1', 'build')
`).run();
db.prepare(`
  INSERT INTO cards (id, display_name, name, project_id, kind)
  VALUES ('card_2', NULL, 'legacy-name', 'project_1', 'research')
`).run();

inbox.record({ id: "card_1" }, "question", "Choose one.", "question:1", 10);
inbox.record({ id: "card_1" }, "error", "Retry failed.", "error:1", 11);
assert.equal(published.length, 2, "new events publish card-scoped inbox changes");
inbox.record({ id: "card_1" }, "error", "Retry failed.", "error:1", 12);
assert.equal(published.length, 2, "deduped lifecycle polling stays silent");

inbox.resolve("card_1", 20, ["error"], "resumed");
const afterResume = db.prepare(`
  SELECT kind, resolved_at, resolved_reason FROM inbox_events
  WHERE card_id = 'card_1' ORDER BY occurred_at
`).all();
assert.deepEqual(afterResume, [
  { kind: "question", resolved_at: null, resolved_reason: null },
  { kind: "error", resolved_at: 20, resolved_reason: "resumed" },
], "resolution remains per-kind and records why the action cleared");
assert.equal(published.at(-1).payload.cardId, "card_1", "a changed resolution refreshes Inbox");

inbox.syncPendingQuestion("card_2", ["ask_1"], 30);
inbox.markAnswered("card_2", ["ask_1"]);
inbox.syncPendingQuestion("card_2", [], 40);
const answered = db.prepare(`
  SELECT resolved_at, resolved_reason FROM inbox_events
  WHERE card_id = 'card_2' AND kind = 'question'
`).get();
assert.deepEqual(answered, { resolved_at: 1_000, resolved_reason: "answered" }, "answer wins over the later disappearance sync");
const beforeReopen = published.length;
inbox.syncPendingQuestion("card_2", ["ask_1"], 50);
const reopened = db.prepare(`
  SELECT resolved_at, resolved_reason FROM inbox_events
  WHERE card_id = 'card_2' AND kind = 'question'
`).get();
assert.deepEqual(reopened, { resolved_at: null, resolved_reason: null }, "a still-pending interaction reopens its durable row with no stale reason");
assert.equal(published.length, beforeReopen + 1, "reopen publishes the changed lifecycle state");
assert.equal(published.at(-1).payload.cardId, "card_2", "reopen refreshes the owning card");
inbox.markAnswered("card_2", ["ask_1"]);
inbox.syncPendingQuestion("card_2", [], 60);

inbox.record({ id: "card_1" }, "completed", "Build complete.", "completed:1", 50);
const completedId = db.prepare(`
  SELECT id FROM inbox_events WHERE dedupe_key = 'completed:1'
`).get().id;
db.prepare(`
  UPDATE inbox_events SET severity = 2, severity_reasons = '["error ×2"]'
  WHERE id = ?
`).run(completedId);
const listed = await handlers.listNotifications({ includeArchived: false });
const question = listed.notifications.find((row) => row.kind === "question" && row.cardId === "card_1");
const legacy = listed.notifications.find((row) => row.cardId === "card_2");
assert.equal(question.cardName, "Shown name", "panel rows prefer the card display name");
assert.equal(question.projectName, "Project One", "project ids resolve to names");
assert.equal(legacy.cardName, "legacy-name", "legacy cards fall back to their durable name");
assert.equal(legacy.resolvedReason, "answered", "resolved history retains its reason");
assert.equal(legacy.severity, 1, "stored routine severity reaches the snapshot");
const completion = listed.notifications.find((row) => row.id === completedId);
assert.deepEqual(
  { severity: completion.severity, reasons: completion.severityReasons },
  { severity: 2, reasons: ["error ×2"] },
  "stored escalation and reasons reach the snapshot without recomputation",
);

let publications = published.length;
await handlers.markNotificationRead({ notificationId: question.id });
assert.equal(published.length, publications + 1, "first read acknowledgement publishes");
assert.equal(published.at(-1).payload.notificationId, question.id, "read refreshes the changed event");
publications = published.length;
assert.equal((await handlers.markNotificationRead({ notificationId: question.id })).ok, false, "read acknowledgement is idempotent");
assert.equal(published.length, publications, "an unchanged read stays silent");
// The other half, and the reason the item's own button can be reversible:
// marking unread returns the update to attention, which archive deliberately
// does not. Both are idempotent, so a double click publishes once.
assert.equal((await handlers.markNotificationUnread({ notificationId: question.id })).ok, true, "unread clears the read stamp");
assert.equal(
  db.prepare("SELECT read_at FROM inbox_events WHERE id = ?").get(question.id).read_at,
  null,
  "the update is unread again, so it returns to Needs attention",
);
assert.equal((await handlers.markNotificationUnread({ notificationId: question.id })).ok, false, "unread acknowledgement is idempotent too");
assert.equal(
  db.prepare("SELECT archived_at FROM inbox_events WHERE id = ?").get(question.id).archived_at,
  null,
  "and neither direction touches the archive, which is the separate, one-way decision");
assert.equal(
  (await handlers.markCardNotificationsRead({ cardId: "card_1", kind: "question" })).marked,
  false,
  "viewing an action card never clears its unresolved badge",
);
publications = published.length;
assert.equal(
  (await handlers.markCardNotificationsRead({ cardId: "card_1", kind: "completed" })).marked,
  true,
  "viewing Done clears only unread completion state",
);
assert.equal(published.length, publications + 1, "card completion acknowledgement publishes");
assert.equal(published.at(-1).payload.cardId, "card_1", "card read refreshes its completion history");
assert.equal(
  db.prepare("SELECT resolved_at FROM inbox_events WHERE id = ?").get(completedId).resolved_at,
  null,
  "read never resolves a completion",
);

publications = published.length;
await handlers.archiveNotification({ notificationId: completedId });
assert.equal(published.length, publications + 1, "archive publishes its changed event");
assert.equal(published.at(-1).payload.notificationId, completedId, "archive refreshes the affected event");
assert.equal(
  (await handlers.listNotifications({ includeArchived: false })).notifications.some((row) => row.id === completedId),
  false,
  "archived rows leave active history but remain durable",
);
assert.equal(
  (await handlers.listNotifications({ includeArchived: true })).notifications.some((row) => row.id === completedId),
  true,
  "the archive view retains the hidden row",
);
publications = published.length;
await handlers.restoreNotification({ notificationId: completedId });
assert.equal(published.length, publications + 1, "restore publishes its changed event");
assert.equal(published.at(-1).payload.notificationId, completedId, "restore refreshes the affected event");
assert.equal(
  (await handlers.listNotifications({ includeArchived: false })).notifications.some((row) => row.id === completedId),
  true,
  "restore returns an archived row to history",
);
assert.equal((await handlers.getNotification({ notificationId: completedId, cardId: "wrong" })).notification, null, "detail reads stay card-scoped");
const owned = await handlers.getNotification({
  notificationId: completedId,
  cardId: "card_1",
});
assert.equal(owned.notification.id, completedId, "the owning card reads its event");

// How opening a card satisfies a review request the card itself carries.
//
// The premise under test: opening the card IS the satisfying action, so the
// write is keyed to that and to nothing else. That was worth a test of its
// own because an incident memo got it backwards — it recorded that opening a
// card does NOT mark the notification read, and that false premise would have
// justified "fixing" a shipped behaviour that was already correct.
//
// Verified before writing this, not assumed: `cardDetail` has exactly ONE call
// site (`build-detail-body.tsx`), and its hook is mounted only by the three
// detail-route adapters. There is no prefetch, so no write can be spent on a
// card the reader never chose. That is why this tests the write, not the read.
const reviewDb = new Database(":memory:");
reviewDb.exec(`
  PRAGMA foreign_keys = ON;
  CREATE TABLE cards (
    id TEXT PRIMARY KEY,
    display_name TEXT,
    name TEXT NOT NULL,
    project_id TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'build'
  );
`);
runInboxMigrations(reviewDb);
let reviewId = 0;
const reviewInbox = createInboxServer({
  db: reviewDb,
  now: () => 2_000,
  randomId: (prefix) => `${prefix}_review_${(reviewId += 1)}`,
  publish: () => {},
  listProjects: async () => [{ id: "project_1", name: "Project One" }],
});
reviewDb.prepare("INSERT INTO cards VALUES ('card_r', 'Reviewed', 'reviewed', 'project_1', 'build')").run();
reviewDb.prepare("INSERT INTO cards VALUES ('card_x', 'Archived', 'archived', 'project_1', 'build')").run();
reviewDb.prepare("INSERT INTO cards VALUES ('card_o', 'Other kinds', 'other-kinds', 'project_1', 'build')").run();

reviewInbox.record({ id: "card_r" }, "completed", "Done.", "completed:card_r", 10);
const reviewRow = reviewDb.prepare("SELECT id FROM inbox_events WHERE card_id = 'card_r'").get().id;
assert.equal(
  hasPendingReview(reviewDb, "card_r"),
  true,
  "a completion nobody opened is the review request the card carries",
);
assert.equal(
  (await reviewInbox.handlers.markCardNotificationsRead({ cardId: "card_r", kind: "completed" })).marked,
  true,
  "opening the card clears the review request",
);
assert.equal(
  hasPendingReview(reviewDb, "card_r"),
  false,
  "the board's predicate and the write agree: after opening, no review is pending",
);
assert.equal(
  (await reviewInbox.handlers.markCardNotificationsRead({ cardId: "card_r", kind: "completed" })).marked,
  false,
  "re-opening a card whose completion is already read changes nothing — the write is idempotent",
);
assert.equal(
  hasPendingReview(reviewDb, "card_r"),
  false,
  "a second open cannot resurrect a review that opening already satisfied",
);
assert.equal(
  reviewDb.prepare("SELECT resolved_at FROM inbox_events WHERE id = ?").get(reviewRow).resolved_at,
  null,
  "opening is a read, not a resolution: the completion's own lifecycle is untouched",
);

// Archiving is terminal for the card, so an archived completion must never
// accept a read — the card is unreachable, and recording a read for it would
// be recording that somebody saw work nobody can now open.
reviewInbox.record({ id: "card_x" }, "completed", "Done.", "completed:card_x", 20);
const archivedCompletion = reviewDb.prepare("SELECT id FROM inbox_events WHERE card_id = 'card_x'").get().id;
await reviewInbox.handlers.archiveNotification({ notificationId: archivedCompletion });
assert.equal(
  (await reviewInbox.handlers.markCardNotificationsRead({ cardId: "card_x", kind: "completed" })).marked,
  false,
  "an archived card's completion is not marked read — the read would claim a sighting nobody can make",
);
assert.equal(
  reviewDb.prepare("SELECT read_at FROM inbox_events WHERE id = ?").get(archivedCompletion).read_at,
  null,
  "no read stamp is recorded against an archived completion",
);

// Only the completion kind rides the open. An unread question, error or pause
// is cleared by ANSWERING or by acting — never by looking at the card — so
// this guard is the reason opening a card does not silence live work.
for (const kind of ["question", "error", "paused"]) {
  reviewInbox.record({ id: "card_o" }, kind, `${kind} happened.`, `${kind}:card_o`, 30);
}
assert.equal(
  (await reviewInbox.handlers.markCardNotificationsRead({ cardId: "card_o", kind: "question" })).marked,
  false,
  "opening a card never marks its unresolved question read — answering it does",
);
assert.equal(
  reviewDb.prepare("SELECT COUNT(*) AS count FROM inbox_events WHERE card_id = ? AND read_at IS NOT NULL").get("card_o").count,
  0,
  "no kind other than the completion is marked read by opening the card",
);
assert.equal(
  (await reviewInbox.handlers.markCardNotificationsRead({ cardId: "card_absent", kind: "completed" })).marked,
  false,
  "a card with no completion has nothing to mark, and reports honestly",
);
reviewDb.close();

// Answering resolves the row AND tells the board: without the publish the
// clearance stays invisible until the next tick, so a resolved answer must refresh.
db.prepare(`
  INSERT INTO cards (id, display_name, name, project_id, kind)
  VALUES ('card_3', 'Third', 'card-three', 'project_1', 'build')
`).run();
inbox.syncPendingQuestion("card_3", ["ask_publish"], 70);
publications = published.length;
inbox.markAnswered("card_3", ["ask_publish"]);
assert.equal(published.length, publications + 1, "an answered question publishes its clearance");
assert.equal(published.at(-1).payload.cardId, "card_3", "an answer refreshes the owning card");
assert.deepEqual(db.prepare("SELECT resolved_at, resolved_reason FROM inbox_events WHERE card_id = 'card_3'").get(), {
  resolved_at: 1_000,
  resolved_reason: "answered",
}, "markAnswered resolves the open question as answered");
publications = published.length;
inbox.markAnswered("card_3", ["unknown_id"]);
assert.equal(published.length, publications, "a silent answer with unknown ids stays silent");

db.close();

const legacyDb = new Database(":memory:");
legacyDb.exec(`
  CREATE TABLE cards (id TEXT PRIMARY KEY, kind TEXT NOT NULL);
  CREATE TABLE inbox_events (
    id TEXT PRIMARY KEY,
    card_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    summary TEXT NOT NULL,
    dedupe_key TEXT NOT NULL UNIQUE,
    occurred_at INTEGER NOT NULL,
    read_at INTEGER,
    archived_at INTEGER
  );
  INSERT INTO cards VALUES ('legacy-research', 'research');
  INSERT INTO cards VALUES ('legacy-build', 'build');
  INSERT INTO inbox_events VALUES (
    'duplicate', 'legacy-research', 'completed',
    'Completed. Review the final outcome.', 'legacy:duplicate', 1, NULL, NULL
  );
  INSERT INTO inbox_events VALUES (
    'question', 'legacy-research', 'question',
    'Still needs an answer.', 'legacy:question', 2, NULL, NULL
  );
  INSERT INTO inbox_events VALUES (
    'research-result', 'legacy-research', 'completed',
    'Research complete — results ready.', 'legacy:research-result', 3, NULL, NULL
  );
  INSERT INTO inbox_events VALUES (
    'build-completion', 'legacy-build', 'completed',
    'Completed. Review the final outcome.', 'legacy:build-completion', 4, NULL, NULL
  );
`);
runInboxMigrations(legacyDb);
const columns = legacyDb.prepare("PRAGMA table_info(inbox_events)").all().map((column) => column.name);
assert.ok(columns.includes("resolved_at"), "legacy rows gain the resolution timestamp");
assert.ok(columns.includes("resolved_reason"), "legacy rows gain the resolution reason");
assert.ok(columns.includes("severity"), "legacy rows gain severity");
assert.ok(columns.includes("holder_card_id"), "legacy rows gain the holder id — the affordance is a column, not prose to re-parse");
assert.ok(columns.includes("holder_file"), "legacy rows gain the held file");
assert.ok(columns.includes("severity_reasons"), "legacy rows gain severity reasons");
assert.deepEqual(
  legacyDb.prepare("SELECT id FROM inbox_events ORDER BY id").all().map((row) => row.id),
  ["build-completion", "question", "research-result"],
  "cleanup removes only the historical duplicate research completion",
);
legacyDb.close();

console.log("server inbox test ok: migrations, per-kind lifecycle, read/archive/restore, history, and publication");

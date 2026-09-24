import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { createInboxServer, runInboxMigrations } from "../server/inbox.ts";

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
assert.deepEqual(reopened, { resolved_at: null, resolved_reason: "answered" }, "a still-pending interaction reopens its durable row");
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
assert.ok(columns.includes("severity_reasons"), "legacy rows gain severity reasons");
assert.deepEqual(
  legacyDb.prepare("SELECT id FROM inbox_events ORDER BY id").all().map((row) => row.id),
  ["build-completion", "question", "research-result"],
  "cleanup removes only the historical duplicate research completion",
);
legacyDb.close();

console.log("server inbox test ok: migrations, per-kind lifecycle, read/archive/restore, history, and publication");

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { ensureColumns } from "../lib/sqlite-columns.mjs";
import { ensureAutoContinueColumns } from "../lib/auto-continue.mjs";
import { ensureInboxResolvedReasonColumn, ensureInboxSeverityColumns } from "../lib/inbox-events.mjs";

// One migration helper instead of one per call site. These are the rules the
// duplicates each had to get right on their own: a re-run adds nothing, a
// legacy row reads the declared default, and two specs for one table in a
// single call cannot collide.
const db = new Database(":memory:");
db.exec("CREATE TABLE cards (id TEXT PRIMARY KEY)");
db.prepare("INSERT INTO cards (id) VALUES ('legacy')").run();

ensureColumns(db, "cards", [
  ["auto_continue_count", "INTEGER NOT NULL DEFAULT 0"],
  ["auto_continue_stage", "TEXT"],
]);
assert.deepEqual(
  db.prepare("PRAGMA table_info(cards)").all().map((column) => column.name),
  ["id", "auto_continue_count", "auto_continue_stage"],
  "the missing columns are added, in order",
);
const legacy = db.prepare("SELECT * FROM cards WHERE id = 'legacy'").get();
assert.equal(legacy.auto_continue_count, 0, "a legacy row reads the declared default, never null");
assert.equal(legacy.auto_continue_stage, null, "a nullable column stays null on legacy rows");

ensureColumns(db, "cards", [["auto_continue_count", "INTEGER NOT NULL DEFAULT 0"]]);
assert.equal(db.prepare("PRAGMA table_info(cards)").all().length, 3, "a re-run adds nothing");

ensureColumns(db, "cards", [["a", "TEXT"], ["b", "TEXT"]]);
assert.deepEqual(
  db.prepare("PRAGMA table_info(cards)").all().map((column) => column.name).slice(-2),
  ["a", "b"],
  "two specs in one call cannot collide with each other",
);

// The call sites DELEGATE to the shared helper. Driven: a legacy table missing
// the columns gets them installed by each module's own entry point, so a module
// that dropped the call (or spelled its own migration that lost the DDL) fails
// here instead of surviving behind a regex.
{
  const cards = new Database(":memory:");
  cards.exec("CREATE TABLE cards (id TEXT PRIMARY KEY)");
  ensureAutoContinueColumns(cards);
  assert.deepEqual(
    cards.prepare("PRAGMA table_info(cards)").all().map((column) => column.name),
    ["id", "auto_continue_count", "auto_continue_stage"],
    "auto-continue installs its columns through the shared helper",
  );
  cards.close();
}
{
  const inbox = new Database(":memory:");
  inbox.exec("CREATE TABLE inbox_events (id TEXT PRIMARY KEY)");
  ensureInboxResolvedReasonColumn(inbox);
  ensureInboxSeverityColumns(inbox);
  assert.deepEqual(
    inbox.prepare("PRAGMA table_info(inbox_events)").all().map((column) => column.name),
    ["id", "resolved_reason", "severity", "severity_reasons"],
    "inbox-events installs its columns through the shared helper",
  );
  inbox.close();
}

// The regression the helper exists to prevent: the former call sites had
// their own PRAGMA/ALTER copy each, so a fix to the rule had to land twice.
// This one stays a source-shape rule: "no module re-spells the dance" is a
// claim about the code, and a module that re-implemented the same SQL would
// still install the columns — so no execution can distinguish it.
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const autoContinue = readFileSync(join(root, "lib/auto-continue.mjs"), "utf8");
const inboxEvents = readFileSync(join(root, "lib/inbox-events.mjs"), "utf8");
assert.ok(autoContinue.includes('ensureColumns(db, "cards"'), "auto-continue delegates to the shared helper");
assert.ok(inboxEvents.includes('ensureColumns(db, "inbox_events"'), "inbox-events delegates to the shared helper");
assert.equal(
  `${autoContinue}${inboxEvents}`.match(/PRAGMA table_info\(/g)?.length ?? 0,
  0,
  "no module re-spells the migration dance",
);

console.log("sqlite columns test ok: idempotent migrations, one shared helper");

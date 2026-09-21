import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { ensureColumns } from "../lib/sqlite-columns.mjs";

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

// The regression the helper exists to prevent: the former call sites had
// their own PRAGMA/ALTER copy each, so a fix to the rule had to land twice.
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

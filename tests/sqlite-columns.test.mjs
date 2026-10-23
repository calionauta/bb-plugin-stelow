import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { ensureColumns } from "../lib/sqlite-columns.mjs";
import { ensureAutoContinueColumns } from "../lib/auto-continue.mjs";
import { ensureInboxResolvedReasonColumn, ensureInboxSeverityColumns } from "../lib/inbox-events.mjs";
import { ensureInboxQuestionColumns } from "../lib/inbox-question-columns.mjs";

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
    ["id", "auto_continue_count", "auto_continue_stage", "last_idle_text"],
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

// The shared helper is fail-closed: a hostile table name, column name, or DDL
// refuses with a named error instead of executing, and a refusal changes
// nothing — no partial ALTER. Each group snapshots PRAGMA table_info first.
const tableBefore = db.prepare("PRAGMA table_info(cards)").all().map((column) => column.name).join(",");
for (const hostileTable of ['cards"; DROP TABLE cards--', "`cards`", "", 123]) {
  assert.throws(() => ensureColumns(db, hostileTable, [["x", "TEXT"]]), /refusing to migrate table/);
}
assert.equal(
  db.prepare("PRAGMA table_info(cards)").all().map((column) => column.name).join(","),
  tableBefore,
  "a refused table name leaves the table untouched",
);
for (const hostileColumn of ["auto count", 'we"ird', ""]) {
  assert.throws(() => ensureColumns(db, "cards", [[hostileColumn, "TEXT"]]), /refusing to migrate column/);
}
assert.equal(
  db.prepare("PRAGMA table_info(cards)").all().map((column) => column.name).join(","),
  tableBefore,
  "a refused column name adds nothing",
);
for (const hostileDdl of ["TEXT; DROP TABLE cards", "TEXT -- x", "TEXT /* x */", "TEXT\0", "", "   "]) {
  assert.throws(() => ensureColumns(db, "cards", [["refused_col", hostileDdl]]), /refusing to migrate column/);
}
assert.equal(
  db.prepare("PRAGMA table_info(cards)").all().map((column) => column.name).join(","),
  tableBefore,
  "a refused DDL adds nothing",
);
assert.ok(!db.prepare("PRAGMA table_info(cards)").all().some((c) => c.name === "x"), "no probe column survives a refusal");
assert.ok(!db.prepare("PRAGMA table_info(cards)").all().some((c) => c.name === "refused_col"), "no refused DDL column survives");

// The DDL shapes below are copied verbatim from live ensureColumns call sites,
// never invented: TEXT and INTEGER NOT NULL DEFAULT 0 (lib/auto-continue.mjs),
// TEXT and INTEGER NOT NULL DEFAULT 1 plus TEXT NOT NULL DEFAULT '[]'
// (lib/inbox-events.mjs severity pair, lib/inbox-error-event.mjs occurrences),
// TEXT NOT NULL DEFAULT 'standard' (server/core-migrations.ts expired_questions
// kind), TEXT NOT NULL DEFAULT 'build' (cards kind), TEXT NOT NULL DEFAULT
// 'project' (cards workspace_kind), TEXT NOT NULL DEFAULT '[]' (attachments).
{
  const real = new Database(":memory:");
  real.exec("CREATE TABLE cards (id TEXT PRIMARY KEY)");
  ensureColumns(real, "cards", [
    ["r_text", "TEXT"],
    ["r_int", "INTEGER"],
    ["r_zero", "INTEGER NOT NULL DEFAULT 0"],
    ["r_one", "INTEGER NOT NULL DEFAULT 1"],
    ["r_list", "TEXT NOT NULL DEFAULT '[]'"],
    ["r_standard", "TEXT NOT NULL DEFAULT 'standard'"],
    ["r_build", "TEXT NOT NULL DEFAULT 'build'"],
    ["r_project", "TEXT NOT NULL DEFAULT 'project'"],
  ]);
  const realNames = real.prepare("PRAGMA table_info(cards)").all().map((column) => column.name);
  for (const name of ["r_text", "r_int", "r_zero", "r_one", "r_list", "r_standard", "r_build", "r_project"]) {
    assert.ok(realNames.includes(name), `the verified caller DDL for ${name} still passes`);
  }
  real.close();
}

// Old-schema entry points: a legacy table holding a live row gains the columns
// without losing the row, and a second run adds nothing. ensureInboxResolved-
// ReasonColumn already has this shape in tests/inbox-flows.test.mjs, so only
// the three entry points without one are pinned here.
{
  const legacyCards = new Database(":memory:");
  legacyCards.exec("CREATE TABLE cards (id TEXT PRIMARY KEY, stage TEXT NOT NULL)");
  legacyCards.prepare("INSERT INTO cards (id, stage) VALUES ('card_old', 'shape')").run();
  ensureAutoContinueColumns(legacyCards);
  const migratedCards = legacyCards.prepare("PRAGMA table_info(cards)").all().map((c) => c.name);
  for (const name of ["auto_continue_count", "auto_continue_stage", "last_idle_text"]) {
    assert.ok(migratedCards.includes(name), `legacy cards gain ${name}`);
  }
  assert.deepEqual(
    legacyCards.prepare("SELECT id, stage, auto_continue_count FROM cards WHERE id = 'card_old'").get(),
    { id: "card_old", stage: "shape", auto_continue_count: 0 },
    "the legacy cards row survives with its values and declared defaults",
  );
  assert.equal(legacyCards.prepare("SELECT last_idle_text FROM cards WHERE id = 'card_old'").get().last_idle_text, null);
  const cardWidth = migratedCards.length;
  ensureAutoContinueColumns(legacyCards);
  assert.equal(legacyCards.prepare("PRAGMA table_info(cards)").all().length, cardWidth, "the cards migration is idempotent");
  legacyCards.close();
}
{
  const legacyInbox = new Database(":memory:");
  legacyInbox.exec("CREATE TABLE inbox_events (id TEXT PRIMARY KEY, summary TEXT NOT NULL)");
  legacyInbox.prepare("INSERT INTO inbox_events (id, summary) VALUES ('evt_old', 'Paused.')").run();
  ensureInboxSeverityColumns(legacyInbox);
  const migratedInbox = legacyInbox.prepare("PRAGMA table_info(inbox_events)").all().map((c) => c.name);
  assert.ok(migratedInbox.includes("severity"), "legacy inbox rows gain severity");
  assert.ok(migratedInbox.includes("severity_reasons"), "legacy inbox rows gain severity_reasons");
  assert.deepEqual(
    legacyInbox.prepare("SELECT id, summary, severity, severity_reasons FROM inbox_events WHERE id = 'evt_old'").get(),
    { id: "evt_old", summary: "Paused.", severity: 1, severity_reasons: "[]" },
    "the legacy inbox row survives with declared tier defaults",
  );
  const inboxWidth = migratedInbox.length;
  ensureInboxSeverityColumns(legacyInbox);
  assert.equal(legacyInbox.prepare("PRAGMA table_info(inbox_events)").all().length, inboxWidth, "the severity migration is idempotent");
  legacyInbox.close();
}
{
  const legacyQuestions = new Database(":memory:");
  legacyQuestions.exec("CREATE TABLE inbox_events (id TEXT PRIMARY KEY, summary TEXT NOT NULL)");
  legacyQuestions.prepare("INSERT INTO inbox_events (id, summary) VALUES ('evt_q', 'Waiting.')").run();
  ensureInboxQuestionColumns(legacyQuestions);
  const migratedQuestions = legacyQuestions.prepare("PRAGMA table_info(inbox_events)").all().map((c) => c.name);
  for (const name of ["question_summary", "question_count", "question_kind"]) {
    assert.ok(migratedQuestions.includes(name), `legacy inbox rows gain ${name}`);
  }
  assert.deepEqual(
    legacyQuestions.prepare("SELECT id, summary, question_summary FROM inbox_events WHERE id = 'evt_q'").get(),
    { id: "evt_q", summary: "Waiting.", question_summary: null },
    "the legacy question row survives with null question line",
  );
  const questionWidth = migratedQuestions.length;
  ensureInboxQuestionColumns(legacyQuestions);
  assert.equal(legacyQuestions.prepare("PRAGMA table_info(inbox_events)").all().length, questionWidth, "the question migration is idempotent");
  legacyQuestions.close();
}

console.log("sqlite columns test ok: idempotent migrations, one shared helper");

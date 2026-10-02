/**
 * The one ledger record this plugin is allowed to rewrite, and the three it is
 * not.
 *
 * bb records plugin migrations in `_bb_migrations(id, applied_at,
 * statement_hash)`, where `id` is the ARRAY INDEX and the hash is sha256 of the
 * raw statement text. The host checks every recorded position BEFORE executing
 * anything, so a position whose recorded text is wrong refuses the boot forever
 * and no appended migration can reach it.
 *
 * v0.61.0 shipped one such position. It rewrote the `presets` entry of
 * `PRESET_MIGRATION_STATEMENTS` as a generated template literal, so position 3
 * hashed to `3dc92d76…` instead of the released `ba1ac500…`, and every install
 * that ran v0.61.0 became un-upgradeable with a message that reads like a
 * corrupt database. v0.61.1 restored the released literal, which fixes every
 * install that never recorded the bad hash and leaves exactly the ones that did
 * frozen — this is what un-freezes them.
 *
 * These run on a real `node:sqlite` database, and the migrator under test is a
 * faithful re-implementation of the host's (read off the running bundle): same
 * index-keyed check, same refusal text, same "check first, then execute"
 * order. A heal proved against a stub that always succeeds would prove nothing,
 * because the whole defect is that the real one throws.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { healRewrittenLedgerRow, REWRITTEN_LEDGER_REPAIR } from "../lib/migration-ledger-heal.mjs";

/** The host's `migrationStatementHash`, quoted from the running bundle. */
const statementHash = (statement) => createHash("sha256").update(statement).digest("hex");

/**
 * The host's `runPluginStorageMigrations`, re-implemented statement for
 * statement. The mismatch check runs before the transaction, so a throw leaves
 * every table exactly as it was — which is what makes case 3 below a real
 * refusal rather than a partial migration.
 */
function runHostMigrations(db, statements) {
  db.exec("CREATE TABLE IF NOT EXISTS _bb_migrations (id INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL, statement_hash TEXT)");
  if (!db.prepare("PRAGMA table_info(_bb_migrations)").all().some((c) => c.name === "statement_hash")) {
    db.exec("ALTER TABLE _bb_migrations ADD COLUMN statement_hash TEXT");
  }
  const rows = db.prepare("SELECT id, statement_hash FROM _bb_migrations ORDER BY id").all();
  const applied = new Map(rows.map((row) => [row.id, row.statement_hash]));
  const hashes = statements.map(statementHash);
  hashes.forEach((hash, index) => {
    const recorded = applied.get(index);
    if (recorded !== undefined && recorded !== null && recorded !== hash) {
      throw new Error(
        `migration ${index} does not match the recorded statement; append a new migration instead of changing or reusing an index`,
      );
    }
  });
  const record = db.prepare("INSERT INTO _bb_migrations (id, applied_at, statement_hash) VALUES (?, ?, ?)");
  db.exec("BEGIN");
  try {
    for (const statement of statements) {
      const index = statements.indexOf(statement);
      if (applied.has(index)) continue;
      db.exec(statement);
      record.run(index, 1, hashes[index]);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

/**
 * The statements the plugin ships, reduced to what each case needs: `cards` at
 * 0, `comments` at 1, an index at 2, the `presets` DDL at 3. Position 3 is the
 * one under repair, and its text is the released 6-space literal.
 */
const PRESETS_DDL = `CREATE TABLE IF NOT EXISTS presets (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE COLLATE NOCASE,
      provider_id TEXT NOT NULL,
      model_id TEXT NOT NULL,
      reasoning_level TEXT NOT NULL,
      permission_mode TEXT NOT NULL CHECK (permission_mode IN ('accept-edits','auto','full')),
      environment_kind TEXT NOT NULL DEFAULT 'project-default' CHECK (environment_kind IN ('project-default','new-worktree')),
      base_branch TEXT,
      machine_id TEXT,
      instructions TEXT NOT NULL DEFAULT '',
      is_default INTEGER NOT NULL DEFAULT 0,
      built_in INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`;

const STATEMENTS = [
  "CREATE TABLE IF NOT EXISTS cards (id TEXT PRIMARY KEY)",
  "CREATE TABLE IF NOT EXISTS comments (id TEXT PRIMARY KEY)",
  "CREATE INDEX IF NOT EXISTS idx_comments_card ON comments(id)",
  PRESETS_DDL,
];
const SHIPPED_AT_THREE = statementHash(PRESETS_DDL);

const BAD = "3dc92d7678bae74f81a8ea5f95bf3b05ccaaf3a02d798492882f2d83edbd80f8";

/** A database that has already migrated, with position 3 forced to `hash`. */
function migratedWithPositionThree(hash) {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE _bb_migrations (id INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL, statement_hash TEXT)");
  const record = db.prepare("INSERT INTO _bb_migrations (id, applied_at, statement_hash) VALUES (?, ?, ?)");
  for (let index = 0; index < STATEMENTS.length; index++) {
    record.run(index, 1, index === 3 ? hash : statementHash(STATEMENTS[index]));
  }
  return db;
}

const recordedAt = (db, index) => db.prepare("SELECT statement_hash FROM _bb_migrations WHERE id = ?").get(index).statement_hash;

// node:sqlite hands back null-prototype rows, so they are copied before compare.
const rows = (found) => found.map((row) => ({ ...row }));

test("the two hashes this repairs are the real ones, not a pair that looks right", () => {
  assert.equal(REWRITTEN_LEDGER_REPAIR.index, 3, "the presets DDL is the statement at position 3");
  assert.equal(REWRITTEN_LEDGER_REPAIR.recordedHash, BAD, "the recorded value is what v0.61.0 shipped");
  assert.equal(REWRITTEN_LEDGER_REPAIR.shippedHash, SHIPPED_AT_THREE,
    "the replacement is the hash of the statement the plugin is about to run, not a constant that can drift from it");
  assert.notEqual(BAD, SHIPPED_AT_THREE, "the two differ, or there is no defect to repair");
  assert.equal(BAD.length, 64, "a full sha256, so the match below is on the whole value and never a prefix");
});

test("a database frozen by v0.61.0 boots again, and its record is corrected", () => {
  const db = migratedWithPositionThree(BAD);
  // The defect, first: the host refuses this boot as it stands.
  assert.throws(() => runHostMigrations(db, STATEMENTS), /migration 3 does not match the recorded statement/,
    "without the repair this install is un-upgradeable, which is what the heal exists for");

  const repair = healRewrittenLedgerRow(db, STATEMENTS);
  assert.deepEqual(repair, { index: 3, recordedHash: BAD, shippedHash: SHIPPED_AT_THREE },
    "the repair names the position it corrected and both values, so the boot can say what it did");
  assert.equal(recordedAt(db, 3), SHIPPED_AT_THREE, "position 3 now records the released text");

  runHostMigrations(db, STATEMENTS);
  runHostMigrations(db, STATEMENTS);
  assert.equal(recordedAt(db, 3), SHIPPED_AT_THREE, "two boots later the record still holds");
  assert.deepEqual(
    db.prepare("SELECT id, statement_hash FROM _bb_migrations ORDER BY id").all().map((r) => r.statement_hash),
    STATEMENTS.map(statementHash),
    "the whole ledger now reads as the released text at every position",
  );
  db.close();
});

test("a healthy install is left byte-identical, and nothing is written", () => {
  const db = migratedWithPositionThree(SHIPPED_AT_THREE);
  const before = db.prepare("SELECT id, applied_at, statement_hash FROM _bb_migrations ORDER BY id").all();

  const repair = healRewrittenLedgerRow(db, STATEMENTS);
  assert.equal(repair, null, "there is nothing to repair on a healthy ledger");

  const after = db.prepare("SELECT id, applied_at, statement_hash FROM _bb_migrations ORDER BY id").all();
  assert.deepEqual(rows(after), rows(before), "every row, including applied_at, is exactly as found");
  runHostMigrations(db, STATEMENTS);
  assert.deepEqual(
    rows(db.prepare("SELECT id, applied_at, statement_hash FROM _bb_migrations ORDER BY id").all()),
    rows(before),
    "and the migration run itself changes nothing either",
  );
  db.close();
});

test("a third value is left alone, and the boot still refuses — the heal is not a blanket pass", () => {
  // A real drift: somebody edited the statement at position 3 without the
  // ledger's knowledge. This is the case a lenient heal would silence, and
  // silencing it is worse than the defect: the operator would boot into a schema
  // the recorded text does not describe.
  const other = statementHash("CREATE TABLE IF NOT EXISTS presets (id TEXT PRIMARY KEY)");
  const db = migratedWithPositionThree(other);
  let declined = null;

  const repair = healRewrittenLedgerRow(db, STATEMENTS, (why) => { declined = why; });
  assert.equal(repair, null, "an unknown record is not rewritten");
  assert.equal(recordedAt(db, 3), other, "position 3 is exactly as found");
  assert.equal(declined, null, "an unknown record is not this plugin's to explain, so it makes no claim");
  assert.throws(() => runHostMigrations(db, STATEMENTS), /migration 3 does not match the recorded statement/,
    "the host still refuses, and refusing is the correct outcome here");

  // The other direction: the record IS the v0.61.0 one, but the statement the
  // plugin is about to run is no longer the released text. Repairing then would
  // bless a drifted migration, so the repair declines out loud and the host's
  // refusal stands.
  const drifted = [...STATEMENTS];
  drifted[3] = "CREATE TABLE IF NOT EXISTS presets (id TEXT PRIMARY KEY, extra TEXT)";
  const db3 = migratedWithPositionThree(BAD);
  let why = null;
  assert.equal(healRewrittenLedgerRow(db3, drifted, (reason) => { why = reason; }), null,
    "a drifted statement is not repaired over");
  assert.match(why ?? "", /left alone/, "and the boot says why, so the refusal is not bare");
  assert.equal(recordedAt(db3, 3), BAD, "the bad record is left exactly as found");
  assert.throws(() => runHostMigrations(db3, drifted), /migration 3 does not match the recorded statement/);
  db3.close();

  // A prefix of the bad hash is a different value, so it is not the bad record.
  const db2 = migratedWithPositionThree(BAD.slice(0, 16));
  assert.equal(healRewrittenLedgerRow(db2, STATEMENTS), null, "a prefix match must not count as the known value");
  assert.equal(recordedAt(db2, 3), BAD.slice(0, 16), "and leaves that row untouched");
  assert.throws(() => runHostMigrations(db2, STATEMENTS), /migration 3 does not match the recorded statement/);
  db.close();
  db2.close();
});

test("a fresh install is unaffected, and a database with no ledger is not given one", () => {
  const db = new DatabaseSync(":memory:");
  assert.equal(healRewrittenLedgerRow(db, STATEMENTS), null, "nothing recorded, nothing repaired");
  assert.equal(
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = '_bb_migrations'").get(),
    undefined,
    "the repair does not create the ledger; the host's own migrator owns that table",
  );
  runHostMigrations(db, STATEMENTS);
  const recorded = db.prepare("SELECT id, statement_hash FROM _bb_migrations ORDER BY id").all();
  assert.deepEqual(recorded.map((r) => r.statement_hash), STATEMENTS.map(statementHash),
    "a fresh install records the released hashes, which is the state the repair returns installs to");
  db.close();
});

test("a pre-hash ledger is left for the host to adopt, not rewritten here", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE _bb_migrations (id INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)");
  db.prepare("INSERT INTO _bb_migrations (id, applied_at) VALUES (0, 1)").run();
  assert.equal(healRewrittenLedgerRow(db, STATEMENTS), null, "no statement_hash column, so no value to compare");
  assert.equal(
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = '_bb_migrations'").get().name,
    "_bb_migrations",
    "and the table is not altered behind the host's back",
  );
  db.close();
});

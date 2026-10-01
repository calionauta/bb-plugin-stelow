/**
 * The ALTER tables, pinned as a record because they are NOT legacy code.
 *
 * A commit message shipped the opposite claim: `ensureColumns` and its callers
 * were filed as "category (b) — exists only to serve an older shape — candidates
 * for later", alongside every `addColumnIfMissing`, `WORKER_COLUMNS`, and the two
 * `PRAGMA table_info` rebuilds. That was measured and it is wrong for two thirds
 * of the list, and the difference is not a judgement call: it is whether the
 * ALTER fires on an EMPTY database.
 *
 * It does. `CREATE TABLE IF NOT EXISTS cards` is frozen — bb records each
 * migration by ARRAY INDEX and hashes its text, so the released DDL can never
 * gain a column (see `tests/migration-statement-hashes.test.mjs`). Every card
 * column added after the first release, including `kind` and the newest one,
 * `read_miss_since`, therefore exists on a fresh install only because an ALTER
 * created it. Delete the ALTER and the install starts without the column; the
 * class of failure is the v0.61.0 boot refusal, not a tidy-up.
 *
 * Source of the expectation: `tests/fixtures/migration-appended-columns.json`,
 * read as data, so an append reads as one added line and a deletion reads as a
 * removed one. The honest debt in this area is the opposite of "legacy": these
 * ALTERs are the schema's only append path, and until there is a real versioned
 * migration mechanism they cannot be retired.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import Database from "better-sqlite3";
import { runPluginMigrations } from "../server/core-migrations.ts";

const APPENDED_COLUMNS = JSON.parse(
  readFileSync(new URL("./fixtures/migration-appended-columns.json", import.meta.url), "utf8"),
);

function migrationHost(db) {
  return {
    storage: {
      migrate: (_database, statements) => {
        for (const statement of statements) db.exec(statement);
      },
    },
  };
}

function assertMigratedSchema(db) {
  for (const name of [
    "display_name",
    "last_idle_at",
    "workspace_kind",
    "workspace_path",
    "workspace_host_id",
    "kind",
    "research_strategy",
    "research_strategies",
    "explore_stage",
    "split_from",
  ]) {
    const columns = new Set(db.prepare("PRAGMA table_info(cards)").all().map((row) => row.name));
    assert.equal(columns.has(name), true, `cards.${name} exists`);
  }
  assert.equal(new Set(db.prepare("PRAGMA table_info(expired_questions)").all().map((row) => row.name)).has("kind"), true);
  assert.equal(new Set(db.prepare("PRAGMA table_info(expired_questions)").all().map((row) => row.name)).has("locale"), true);
  assert.equal(new Set(db.prepare("PRAGMA table_info(automation_rules)").all().map((row) => row.name)).has("autostart"), true);

  const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name));
  for (const name of [
    "ask_contracts",
    "split_proposals",
    "verification_runs",
    "card_stage_events",
    "question_evidence",
    "card_claims",
    "inbox_events",
  ]) {
    assert.equal(tables.has(name), true, `${name} exists`);
  }
}

test("core migrations preserve legacy cards while creating the current schema", () => {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE cards (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      prompt TEXT NOT NULL,
      intent TEXT NOT NULL,
      status TEXT NOT NULL,
      stage TEXT NOT NULL,
      activity TEXT NOT NULL,
      worker_thread_id TEXT,
      worker_preset_id TEXT,
      dir_hash TEXT,
      attachments TEXT NOT NULL DEFAULT '[]',
      last_error TEXT,
      last_assistant_text TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE comments (
      id TEXT PRIMARY KEY,
      card_id TEXT NOT NULL,
      target TEXT NOT NULL,
      target_id TEXT NOT NULL,
      author TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);
  db.prepare("INSERT INTO cards VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run("card-1", "project-1", "Legacy", "prompt", "feature", "in-progress", "build", "idle", null, null, null, "[]", null, null, 1, 1);
  db.prepare("INSERT INTO comments VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run("comment-1", "card-1", "card", "card-1", "user", "keep me", 1);

  const now = () => 100;
  runPluginMigrations(migrationHost(db), db, now);
  runPluginMigrations(migrationHost(db), db, now);

  assert.deepEqual(db.prepare("SELECT id, name, prompt FROM cards").get(), {
    id: "card-1",
    name: "Legacy",
    prompt: "prompt",
  });
  assert.equal(db.prepare("SELECT body FROM comments WHERE id = 'comment-1'").get().body, "keep me");
  assertMigratedSchema(db);
});

test("a fresh install gets every column the appends create", () => {
  const db = new Database(":memory:");
  runPluginMigrations(migrationHost(db), db, () => 1);

  for (const [table, columns] of Object.entries(APPENDED_COLUMNS)) {
    const present = new Map(
      db.prepare(`PRAGMA table_info(${table})`).all().map((row) => [row.name, row]),
    );
    assert.notEqual(present.size, 0, `${table} exists on a fresh install`);
    for (const [name, ddl] of columns) {
      const column = present.get(name);
      assert.notEqual(
        column,
        undefined,
        `${table}.${name} exists on a fresh install. The released CREATE TABLE cannot gain a column `
        + "— its text is hashed and bb refuses to boot on a mismatch — so the ALTER is the only thing "
        + "that creates this one. Removing it strands the column, which is the v0.61.0 failure class.",
      );
      // The declared default is part of what the column means, not decoration: an
      // older row has to read the same value a new one would. SQLite reports
      // `dflt_value` as the literal expression text it stored, so compare that.
      if (/\bNOT NULL\b/.test(ddl)) {
        assert.equal(column.notnull, 1, `${table}.${name} is NOT NULL as declared`);
      }
      const declared = ddl.match(/DEFAULT\s+(.+)$/);
      if (declared) {
        assert.equal(
          column.dflt_value,
          declared[1].trim(),
          `${table}.${name} keeps its declared default, so an older row reads what a new one would`,
        );
      }
    }
  }

  db.close();
});

test("the appends are idempotent, so a second boot adds nothing", () => {
  const db = new Database(":memory:");
  runPluginMigrations(migrationHost(db), db, () => 1);
  const after = Object.fromEntries(
    Object.keys(APPENDED_COLUMNS).map((table) => [
      table,
      db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name),
    ]),
  );
  runPluginMigrations(migrationHost(db), db, () => 2);
  for (const [table, columns] of Object.entries(after)) {
    assert.deepEqual(
      db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name),
      columns,
      `${table} gains no column and loses none on a second boot`,
    );
  }
  db.close();
});

import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { runPluginMigrations } from "../server/core-migrations.ts";

function migrationHost(db) {
  return {
    storage: {
      migrate: (_database, statements) => {
        for (const statement of statements) db.exec(statement);
      },
    },
  };
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
    assert.equal(new Set(db.prepare("PRAGMA table_info(cards)").all().map((row) => row.name)).has(name), true, `cards.${name} exists`);
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
});

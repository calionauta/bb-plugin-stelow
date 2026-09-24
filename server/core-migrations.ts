import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { ensureAutoContinueColumns } from "../lib/auto-continue.mjs";
import { ensureCardClaimsTables } from "../lib/card-claims.mjs";
import { ensureColumns } from "../lib/sqlite-columns.mjs";
import { ensureTrackableEventsTable } from "../lib/trackable-events.mjs";
import { runDecisionApiMigrations } from "./decision-api.js";
import { runGithubMigrations } from "./github-issues.js";
import { runInboxMigrations } from "./inbox.js";
import { PRESET_MIGRATION_STATEMENTS, runPresetMigrations } from "./presets.js";
import { runPublicationMigrations } from "./artifacts-publication.js";
import { runWorkerMigrations } from "./workers.js";
import { runWorkspaceRecoveryMigrations } from "./workspaces-recovery.js";

type Db = ReturnType<BbPluginApi["storage"]["database"]>;

const CARD_COLUMNS: Array<[string, string]> = [
  ["display_name", "TEXT"],
  ["last_idle_at", "INTEGER"],
  ["dir_hash", "TEXT"],
  ["attachments", "TEXT NOT NULL DEFAULT '[]'"],
  ["workspace_kind", "TEXT NOT NULL DEFAULT 'project'"],
  ["workspace_path", "TEXT"],
  ["workspace_host_id", "TEXT"],
  ["kind", "TEXT NOT NULL DEFAULT 'build'"],
  ["research_strategy", "TEXT"],
  ["research_strategies", "TEXT"],
  ["explore_stage", "TEXT"],
  ["split_from", "TEXT"],
];

function createBaseTables(bb: BbPluginApi, db: Db): void {
  bb.storage.migrate(db, [
    `CREATE TABLE IF NOT EXISTS cards (
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
    )`,
    `CREATE TABLE IF NOT EXISTS comments (
      id TEXT PRIMARY KEY,
      card_id TEXT NOT NULL,
      target TEXT NOT NULL,
      target_id TEXT NOT NULL,
      author TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE
    )`,
    "CREATE INDEX IF NOT EXISTS idx_comments_card ON comments(card_id, created_at)",
    ...PRESET_MIGRATION_STATEMENTS,
    `CREATE TABLE IF NOT EXISTS expired_questions (
      id TEXT PRIMARY KEY,
      card_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      question TEXT NOT NULL,
      multiple INTEGER NOT NULL DEFAULT 0,
      options TEXT NOT NULL,
      expired_at INTEGER NOT NULL,
      answered INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE
    )`,
  ]);
}

function createFeatureTables(db: Db): void {
  db.exec(`CREATE TABLE IF NOT EXISTS ask_contracts (
    id TEXT PRIMARY KEY,
    card_id TEXT NOT NULL,
    question_text TEXT NOT NULL,
    contract_id TEXT NOT NULL,
    asked_at INTEGER NOT NULL,
    consumed_at INTEGER,
    FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE
  )`);
  db.exec("CREATE INDEX IF NOT EXISTS idx_ask_contracts_card ON ask_contracts(card_id, consumed_at, asked_at)");
  db.exec(`CREATE TABLE IF NOT EXISTS split_proposals (
    card_id TEXT PRIMARY KEY,
    question TEXT NOT NULL DEFAULT '',
    slices TEXT NOT NULL,
    selected TEXT,
    asked_at INTEGER NOT NULL,
    answered_at INTEGER,
    consumed_at INTEGER,
    created TEXT NOT NULL DEFAULT '[]'
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS verification_runs (
    id TEXT PRIMARY KEY,
    card_id TEXT NOT NULL,
    command TEXT NOT NULL,
    git_root TEXT NOT NULL,
    head_sha TEXT NOT NULL,
    exit_code INTEGER NOT NULL,
    output_sha256 TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE
  )`);
  db.exec("CREATE INDEX IF NOT EXISTS idx_verification_runs_card ON verification_runs(card_id, created_at DESC)");
  db.exec(`CREATE TABLE IF NOT EXISTS card_stage_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    card_id TEXT NOT NULL,
    stage TEXT NOT NULL,
    entered_at INTEGER NOT NULL,
    FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE
  )`);
  db.exec("CREATE INDEX IF NOT EXISTS idx_card_stage_events_card ON card_stage_events(card_id, entered_at)");
  db.exec(`CREATE TABLE IF NOT EXISTS question_evidence (
    card_id TEXT NOT NULL,
    artifact_path TEXT NOT NULL,
    artifact_sha256 TEXT NOT NULL,
    git_root TEXT,
    head_sha TEXT,
    asked_at INTEGER NOT NULL,
    PRIMARY KEY (card_id, artifact_path),
    FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE
  )`);
}

export function runPluginMigrations(bb: BbPluginApi, db: Db, now: () => number): void {
  createBaseTables(bb, db);
  runWorkerMigrations(db);
  ensureColumns(db, "cards", CARD_COLUMNS);
  ensureColumns(db, "expired_questions", [
    ["kind", "TEXT NOT NULL DEFAULT 'standard'"],
    ["locale", "TEXT"],
  ]);
  ensureTrackableEventsTable(db);
  ensureAutoContinueColumns(db);
  createFeatureTables(db);
  runDecisionApiMigrations(db);
  runInboxMigrations(db);
  runWorkspaceRecoveryMigrations(db);
  ensureCardClaimsTables(db);
  runGithubMigrations(db);
  ensureColumns(db, "automation_rules", [["autostart", "INTEGER NOT NULL DEFAULT 0"]]);
  runPublicationMigrations(db);
  runPresetMigrations(db, now);
}

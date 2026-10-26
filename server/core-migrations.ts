import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { ensureAutoContinueColumns } from "../lib/auto-continue.mjs";
import { ensureCardClaimsTables } from "../lib/card-claims.mjs";
import { ensureColumns } from "../lib/sqlite-columns.mjs";
import { healRewrittenLedgerRow, isLedgerHealEnabled } from "../lib/migration-ledger-heal.mjs";
import { ensureTrackableEventsTable } from "../lib/trackable-events.mjs";
import { runDecisionApiMigrations } from "./decision-api.js";
import { runGithubMigrations } from "./github-migrations.js";
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
  ["read_miss_since", "INTEGER"],
  // Human acceptance of a finished result. A timestamp and nothing else: the
  // host SDK exposes no operator identity, so a name here would be free text
  // wearing attribution's clothes (lib/card-acceptance.mjs).
  ["accepted_at", "INTEGER"],
];

/**
 * The statements the host records, hoisted to a name so the ledger repair can
 * read the same text the migrator is about to hash. The array is the released
 * one, entry for entry and byte for byte; only its location moved, and the hash
 * a position produces depends on the text alone, never on where it is written.
 */
const BASE_MIGRATION_STATEMENTS = [
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
];

function createBaseTables(bb: BbPluginApi, db: Db): void {
  bb.storage.migrate(db, BASE_MIGRATION_STATEMENTS);
}

function createQuestionTables(db: Db): void {
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
  // Additive, and both columns nullable on purpose: every row written before
  // the contrast wiring keeps loading (a legacy question has no premise and
  // therefore no ground to lose), while a NEW derived question cannot be
  // recorded without them (`recordDerivedQuestions` refuses it, naming the
  // field). `reversal_cost` holds `{"level":"low","why":"…"}` as JSON text so
  // the level and its sentence stay one fact.
  ensureColumns(db, "ask_contracts", [
    ["premise", "TEXT"],
    ["reversal_cost", "TEXT"],
  ]);
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

function createExecutionTables(db: Db): void {
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
  db.exec(`CREATE TABLE IF NOT EXISTS scan_runs (
    id TEXT PRIMARY KEY,
    card_id TEXT NOT NULL,
    scanners TEXT NOT NULL,
    git_root TEXT NOT NULL,
    head_sha TEXT NOT NULL,
    exit_code INTEGER NOT NULL,
    report_sha256 TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE
  )`);
  db.exec("CREATE INDEX IF NOT EXISTS idx_scan_runs_card ON scan_runs(card_id, created_at DESC)");
  db.exec(`CREATE TABLE IF NOT EXISTS card_stage_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    card_id TEXT NOT NULL,
    stage TEXT NOT NULL,
    entered_at INTEGER NOT NULL,
    FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE
  )`);
  db.exec("CREATE INDEX IF NOT EXISTS idx_card_stage_events_card ON card_stage_events(card_id, entered_at)");
}

function createFeatureTables(db: Db): void {
  createQuestionTables(db);
  createExecutionTables(db);
}

export function runPluginMigrations(bb: BbPluginApi, db: Db, now: () => number): void {
  // Before `bb.storage.migrate`, and it has to be here: the host checks every
  // recorded position before it executes a single statement, so a bad record is
  // only correctable before the call, and this is the first line of the plugin's
  // own startup that holds an open database. Behind STELOW_HEAL_LEDGER=0's
  // kill switch: the repair rewrites a record the migrator treats as
  // immutable, so an operator who distrusts it can decline and take the
  // host's refusal instead.
  const ledgerHeal = isLedgerHealEnabled(process.env);
  if (!ledgerHeal) {
    bb.log.warn("stelow ledger repair disabled by STELOW_HEAL_LEDGER=0; a v0.61.0 bad record will refuse the boot");
  }
  const repaired = ledgerHeal
    ? healRewrittenLedgerRow(db, BASE_MIGRATION_STATEMENTS, (why) => {
      bb.log.warn(`stelow did not repair the v0.61.0 migration ledger: ${why}`);
    })
    : null;
  if (repaired) {
    bb.log.warn(
      `stelow repaired migration ${repaired.index} in its migration ledger: v0.61.0 recorded `
      + `${repaired.recordedHash.slice(0, 8)}… there and the released statement hashes to `
      + `${repaired.shippedHash.slice(0, 8)}…; no schema change, the recorded text was wrong`,
    );
  }
  createBaseTables(bb, db);
  runWorkerMigrations(db);
  ensureColumns(db, "cards", CARD_COLUMNS);
  ensureColumns(db, "expired_questions", [
    ["kind", "TEXT NOT NULL DEFAULT 'standard'"],
    ["locale", "TEXT"],
  ]);
  ensureCommentDeliveryColumn(db);
  ensureArtifactReviewsTable(db);
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

/**
 * `comments.delivered_at`, and the backfill it needs exactly once.
 *
 * Null means "no answer has carried this comment yet" (lib/answer-feedback).
 * A column added as null says that about every comment a card ever collected, so
 * the first answer after the upgrade would send the card's whole history to the
 * worker inside the resume prompt. The backfill stamps the history with its own
 * timestamp — but it must run ONLY on the boot that adds the column: run on
 * every boot it would stamp the comments genuinely waiting for an answer, and
 * they would never ride.
 */
export function ensureCommentDeliveryColumn(db: Db) {
  // Order-dependent by nature: the caller runs `createBaseTables` first. Guarded
  // anyway, because this is exported and a test (or a future caller) may not be.
  const hasTable = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'comments'")
    .get() !== undefined;
  if (!hasTable) return;
  const hadDelivery = (db.prepare('PRAGMA table_info("comments")').all() as Array<{ name?: string }>)
    .some((column) => column.name === "delivered_at");
  ensureColumns(db, "comments", [["delivered_at", "INTEGER"]]);
  if (hadDelivery) return;
  db.prepare("UPDATE comments SET delivered_at = created_at WHERE delivered_at IS NULL").run();
}

/**
 * A "reviewed" mark, bound to the version of the artifact the person read.
 *
 * The fingerprint is the artifact's `generatedAt` as the detail displays it,
 * not a content hash: the card detail carries no sha, and adding one would put
 * a file read on every card open. Equality is enough to DERIVE staleness —
 * "this was read at a version that is no longer the one on the card" — which is
 * a claim the UI can make and test. A content change that preserves mtime
 * reads as fresh; that weakness is accepted and written down rather than
 * hidden (lib/artifact-review.mjs).
 *
 * Additive and with no backfill: absence of a row means "not reviewed", which
 * is true of every card created before this table existed. That is the
 * opposite of `comments.delivered_at`, where absence meant "waiting for an
 * answer" and the upgrade had to backfill (010e11e5); the difference is the
 * whole lesson of that commit.
 */
export function ensureArtifactReviewsTable(db: Db) {
  db.exec(`CREATE TABLE IF NOT EXISTS artifact_reviews (
      card_id TEXT NOT NULL,
      path TEXT NOT NULL,
      reviewed_at INTEGER NOT NULL,
      reviewed_fingerprint TEXT NOT NULL,
      PRIMARY KEY (card_id, path),
      FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE
    )`);
}

/**
 * GitHub storage: imports, watcher rules and their fire/seen ledgers, and
 * the read-only comment mirror.
 *
 * Every table is self-created with its current columns; the ALTERs exist only
 * for installs that predate a column, and the one backfill (a rule's labels
 * from its old single-label shape) is best-effort by design.
 */
import { normalizeGithubLabels } from "../lib/github-intent.mjs";
import type { GithubDb } from "./github-automation-context.js";

function addColumnIfMissing(db: GithubDb, table: string, column: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some((entry) => entry.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

function createImportTables(db: GithubDb): void {
  db.exec(`CREATE TABLE IF NOT EXISTS github_imports (
    issue_key TEXT PRIMARY KEY,
    repo TEXT NOT NULL,
    number INTEGER NOT NULL,
    label TEXT NOT NULL,
    card_id TEXT,
    imported_at INTEGER NOT NULL,
    FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE SET NULL
  );
  CREATE INDEX IF NOT EXISTS idx_github_imports_label ON github_imports(label);`);
  addColumnIfMissing(db, "github_imports", "commented_at", "INTEGER");
  addColumnIfMissing(db, "github_imports", "claimed_by", "TEXT");
}

// Read-only mirror of linked issue comments: identity is the content
// fingerprint, so re-fetches converge via INSERT OR IGNORE. Self-created
// like every table here — no legacy state, nothing for the v1 cleanup.
function createCommentMirrorTable(db: GithubDb): void {
  db.exec(`CREATE TABLE IF NOT EXISTS github_issue_comments (
    id TEXT PRIMARY KEY,
    card_id TEXT NOT NULL,
    author TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    fetched_at INTEGER NOT NULL,
    FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_github_issue_comments_card ON github_issue_comments(card_id, created_at);`);
}

function createRuleTables(db: GithubDb): void {
  db.exec(`CREATE TABLE IF NOT EXISTS automation_rules (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL, label TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS automation_rule_fires (
    rule_id TEXT NOT NULL, source_key TEXT NOT NULL, card_id TEXT NOT NULL, fired_at INTEGER NOT NULL,
    PRIMARY KEY (rule_id, source_key),
    FOREIGN KEY (rule_id) REFERENCES automation_rules(id) ON DELETE CASCADE,
    FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS automation_rule_seen (
    rule_id TEXT NOT NULL, source_key TEXT NOT NULL, seen_at INTEGER NOT NULL,
    PRIMARY KEY (rule_id, source_key),
    FOREIGN KEY (rule_id) REFERENCES automation_rules(id) ON DELETE CASCADE
  );`);
  // No continuity shims for pre-module rule shapes: rules carry labels,
  // authors, template, and start policy in their current columns, period.
  // Anything older re-saves through the dialog (parked drafts by default).
  addColumnIfMissing(db, "automation_rules", "labels", "TEXT");
  addColumnIfMissing(db, "automation_rules", "start_immediate", "INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing(db, "automation_rules", "prompt_template", "TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing(db, "automation_rules", "trusted_authors", "TEXT");
  addColumnIfMissing(db, "automation_rule_fires", "outcome", "TEXT");
}

function backfillRuleLabels(db: GithubDb): void {
  const rows = db
    .prepare("SELECT id, label, labels FROM automation_rules")
    .all() as Array<{ id: string; label: string; labels: string | null }>;
  for (const row of rows) {
    if (row.labels) continue;
    try {
      db.prepare("UPDATE automation_rules SET labels = ? WHERE id = ?").run(JSON.stringify(normalizeGithubLabels(row.label).slice(0, 10)), row.id);
    } catch { /* best-effort backfill */ }
  }
}

export function runGithubMigrations(db: GithubDb): void {
  createImportTables(db);
  createCommentMirrorTable(db);
  createRuleTables(db);
  backfillRuleLabels(db);
}

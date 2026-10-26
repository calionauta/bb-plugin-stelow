// Shared database fixture for the artifact-review suites: a real SQLite
// database built by the plugin's own migrations, and a card inserted with the
// columns this checkout actually has. A stub `prepare` would let a broken
// schema pass here, which is the one shortcut these tests must not take.
import Database from "better-sqlite3";
import { ensureExecutionRunTable } from "../../lib/execution-run-ledger.mjs";
import { runPluginMigrations } from "../../server/core-migrations.ts";

export function freshDatabase() {
  const db = new Database(":memory:");
  // No PRAGMA either way: better-sqlite3 12 enables foreign keys BY DEFAULT,
  // so the schema's cascades are live here exactly as they are in production.
  // The card delete also removes marks explicitly, so the invariant does not
  // depend on that default surviving a future connection setting.
  runPluginMigrations(
    {
      storage: { migrate: (_database, statements) => statements.forEach((statement) => db.exec(statement)) },
      log: { warn: () => undefined },
    },
    db,
    () => 1,
  );
  ensureExecutionRunTable(db);
  return db;
}

/** Insert only the columns this checkout has, so a fixture row can carry extras. */
export function insertCard(db, row) {
  const columns = new Set(db.prepare("PRAGMA table_info(cards)").all().map((column) => column.name));
  const keys = Object.keys(row).filter((key) => columns.has(key));
  db.prepare(`INSERT INTO cards (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`)
    .run(...keys.map((key) => row[key]));
}

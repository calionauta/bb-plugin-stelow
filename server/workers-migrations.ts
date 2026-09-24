import type { BbPluginApi } from "@get-bb/plugin-sdk";

type Db = ReturnType<BbPluginApi["storage"]["database"]>;

const WORKER_COLUMNS = [
  ["worker_preset_id", "TEXT"],
  ["preset_restart_pending", "INTEGER NOT NULL DEFAULT 0"],
  ["spawn_retry_count", "INTEGER NOT NULL DEFAULT 0"],
  ["spawn_retry_thread", "TEXT"],
  ["environment_label", "TEXT"],
] as const;

export function runWorkerMigrations(db: Db): void {
  const columns = new Set(
    (db.prepare("PRAGMA table_info(cards)").all() as Array<{ name: string }>).map((column) => column.name),
  );
  for (const [name, definition] of WORKER_COLUMNS) {
    if (!columns.has(name)) db.exec(`ALTER TABLE cards ADD COLUMN ${name} ${definition}`);
  }
  db.exec(`CREATE TABLE IF NOT EXISTS card_threads (
    thread_id TEXT PRIMARY KEY,
    card_id TEXT NOT NULL,
    preset_id TEXT,
    started_at INTEGER NOT NULL,
    ended_at INTEGER,
    ended_reason TEXT,
    FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_card_threads_card ON card_threads(card_id, started_at DESC);`);
}

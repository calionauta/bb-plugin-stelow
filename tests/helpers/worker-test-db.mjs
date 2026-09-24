import Database from "better-sqlite3";
import { runWorkerMigrations } from "../../server/workers.ts";

export function workerTestDb({ cardId = "card-1", presetId = "preset-a", presetName = "Primary" } = {}) {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE cards (id TEXT PRIMARY KEY);
    CREATE TABLE presets (id TEXT PRIMARY KEY, name TEXT NOT NULL);
  `);
  db.prepare("INSERT INTO presets VALUES (?, ?)").run(presetId, presetName);
  runWorkerMigrations(db);
  db.prepare("INSERT INTO cards (id) VALUES (?)").run(cardId);
  return db;
}

import { runWorkerMigrations } from "../../server/workers.ts";
import { testDatabase } from "./test-database.mjs";

export function workerTestDb({ cardId = "card-1", presetId = "preset-a", presetName = "Primary" } = {}) {
  return testDatabase(
    `
      CREATE TABLE cards (id TEXT PRIMARY KEY);
      CREATE TABLE presets (id TEXT PRIMARY KEY, name TEXT NOT NULL);
    `,
    runWorkerMigrations,
    (db) => {
      db.prepare("INSERT INTO presets VALUES (?, ?)").run(presetId, presetName);
      db.prepare("INSERT INTO cards (id) VALUES (?)").run(cardId);
    },
  );
}

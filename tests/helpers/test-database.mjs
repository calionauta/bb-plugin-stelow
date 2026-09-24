import Database from "better-sqlite3";

export function testDatabase(schema, migrate, seed) {
  const db = new Database(":memory:");
  db.exec(schema);
  migrate(db);
  seed(db);
  return db;
}

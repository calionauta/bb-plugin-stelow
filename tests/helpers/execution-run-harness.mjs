import { ensureExecutionRunTable } from "../../lib/execution-run-ledger.mjs";
import { testDatabase } from "./test-database.mjs";

/**
 * One in-memory ledger for execution-run tests: a cards table, one card, and
 * the run table at its current schema. The fifth copy of this setup tripped
 * the duplication gate, so the shape lives here once — pass a different card
 * id when the test reads it back by name.
 *
 * The cards row is load-bearing, not ceremony: execution_runs carries a
 * foreign key to cards, so the parent has to exist before a run can be
 * written at all.
 */
export function executionRunDb(cardId = "card_1") {
  return testDatabase(
    "CREATE TABLE cards (id TEXT PRIMARY KEY);",
    ensureExecutionRunTable,
    (db) => {
      db.prepare("INSERT INTO cards (id) VALUES (?)").run(cardId);
    },
  );
}

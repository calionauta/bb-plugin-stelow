/**
 * One repair for the host's migration ledger, and it is deliberately narrow.
 *
 * bb records each plugin migration in `_bb_migrations(id, applied_at,
 * statement_hash)`, where `id` is the ARRAY INDEX and `statement_hash` is
 * sha256 of the raw statement text. The host checks every recorded position
 * BEFORE it executes anything, and refuses to start when a recorded position no
 * longer hashes the same.
 *
 * That check is keyed by index, so no new migration can repair a bad record:
 * appending runs after the refusal, and the refusal is what stops the boot. The
 * only place a bad record can be corrected is the record itself, before the
 * host looks at it.
 *
 * v0.61.0 shipped exactly one such bad record. It rewrote the `presets` entry of
 * `PRESET_MIGRATION_STATEMENTS` as a generated template literal, so the text at
 * position 3 hashed to `3dc92d76…` instead of the released `ba1ac500…`. Any
 * install whose ledger recorded that text is refused on every boot from then on
 * — and the host's message ("migration 3 does not match the recorded statement")
 * reads like a corrupt database when the database is fine. A fresh install never
 * saw it, because the check only fires on a recorded position, which is why the
 * population is exactly the installs that ran v0.61.0.
 *
 * Why this is allowed to touch a record the migrator treats as immutable: the
 * migrator's contract is about STATEMENTS, and this repairs a RECORD of a
 * statement that is still exactly the released one. The recorded text was never
 * what shipped at v0.61.1 — it was a transcription of the generated form, and
 * the statement it claims to describe has been unchanged since before v0.61.0.
 * The precedent is in the same area: `ensureCurrentPresets` in
 * `server/preset-migrations.ts` reaches the current table shape outside the
 * ledger for the same reason. The ledger is not silently rewritten here beyond
 * this one value: `shippedHash` is compared against the statement the plugin is
 * about to run, so if that statement ever drifts again, the repair declines and
 * the host's own refusal stands.
 */
import { createHash } from "node:crypto";

/**
 * The one recorded value this plugin is allowed to rewrite, and what it is
 * rewritten to. `index` is the position in the migration list, `recordedHash`
 * the text v0.61.0 recorded there, `shippedHash` the released text that
 * position has always held. Both are read off a live install's ledger, not
 * derived, because the derivation is the thing that went wrong.
 */
export const REWRITTEN_LEDGER_REPAIR = {
  index: 3,
  recordedHash: "3dc92d7678bae74f81a8ea5f95bf3b05ccaaf3a02d798492882f2d83edbd80f8",
  shippedHash: "ba1ac50033315c14f2c33b9f56cbacd380cf9ee96e5521901d53b07284c3ad07",
};

/** The same hash the host records, computed the same way. */
export function statementHash(statement) {
  return createHash("sha256").update(statement).digest("hex");
}

/**
 * The recorded value at one position, or null when there is nothing to read.
 *
 * A database that has never migrated has no table, and one that predates the
 * hash column has no value to compare — both are ordinary states, not failures,
 * and neither is this plugin's record to change. So this never creates the
 * table and never adds the column; the host's own migrator owns both.
 */
function recordedHashAt(db, index) {
  const table = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = '_bb_migrations'")
    .get();
  if (!table) return null;
  const columns = db.prepare("PRAGMA table_info(_bb_migrations)").all();
  if (!columns.some((column) => column.name === "statement_hash")) return null;
  const row = db.prepare("SELECT statement_hash FROM _bb_migrations WHERE id = ?").get(index);
  return row ? row.statement_hash : null;
}

/**
 * Correct one recorded position, and nothing else.
 *
 * Fires only on an EXACT full-hash match — a prefix match would rewrite a
 * position whose record is unknown, which is the case the host refuses on
 * purpose. A position holding any other value (including a real mismatch) is
 * left exactly as found, so a genuine drift still refuses the boot instead of
 * being papered over. The UPDATE repeats the recorded value in its WHERE
 * clause, so a concurrent writer that already fixed the row is not overwritten
 * back to the bad hash.
 *
 * Returns the repair it made, or null when it made none. `onDecline` is called
 * with the reason when a matching record was found but not repaired, so the
 * boot can say why it is about to be refused instead of leaving the operator
 * with the host's message alone.
 */
export function healRewrittenLedgerRow(db, statements, onDecline) {
  const repair = REWRITTEN_LEDGER_REPAIR;
  const recorded = recordedHashAt(db, repair.index);
  if (recorded !== repair.recordedHash) return null;
  const shipped = statementHash(statements[repair.index] ?? "");
  if (shipped !== repair.shippedHash) {
    onDecline?.(
      `the statement at migration ${repair.index} no longer hashes to the released `
      + `${repair.shippedHash.slice(0, 8)}… it hashes to ${shipped.slice(0, 8)}…, so the v0.61.0 `
      + "record is left alone and the host's refusal stands",
    );
    return null;
  }
  db.prepare(
    "UPDATE _bb_migrations SET statement_hash = ? WHERE id = ? AND statement_hash = ?",
  ).run(repair.shippedHash, repair.index, repair.recordedHash);
  return { index: repair.index, recordedHash: repair.recordedHash, shippedHash: repair.shippedHash };
}

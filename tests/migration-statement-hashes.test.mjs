/**
 * The migration statements are frozen BY HASH, and this is the check that says so.
 *
 * bb records each plugin migration in `_bb_migrations(id, applied_at,
 * statement_hash)`, where `id` is the ARRAY INDEX and the hash is sha256 of the
 * raw statement text. It checks every recorded position before executing
 * anything and refuses to start on any mismatch. So the text of a statement at a
 * position that has shipped is part of the plugin's public interface with every
 * install, and no appended migration can repair a bad record: the append runs
 * after the refusal, and the refusal is what stops the boot.
 *
 * v0.61.0 shipped exactly that. It rewrote the `presets` entry of
 * `PRESET_MIGRATION_STATEMENTS` as a generated template literal — two spaces
 * where the released literal has six — and emitted one entry where it had
 * emitted two. Twelve schema tests passed and the release could not boot on a
 * single install that had run it. Detecting that is hashing the statements, and
 * nothing in the repository did.
 *
 * Where the expectation lives, and why: `tests/fixtures/migration-statement-
 * hashes.json`, one `{index, hash}` per released position, read as data rather
 * than written inline. A hash list inside this file would work too, and would be
 * one file fewer — but then appending a migration edits the same source the
 * assertion lives in, which is the shape that makes a golden quietly grow until
 * nobody can tell an approved append from an approved reformat. As a JSON record
 * next to the test, an append is one added line in a file whose only content is
 * hashes: a reviewer sees a new position and an unchanged prefix, with no
 * possible way to also "adjust" the existing entries by accident. Deriving the
 * expectation from a git tag instead would need the network on every run and
 * would still have to answer "which tag is released" — the ledger below already
 * answers it, by being the thing that shipped.
 *
 * The property the shape buys: EDITING a released statement is red, APPENDING a
 * new one is green until the record is extended. That asymmetry is deliberate.
 * An edit is the defect class, and it fails naming its index. An append is the
 * sanctioned act, and the record's own length check tells the author to add the
 * entry. Removing a statement is red too — a shorter list cannot satisfy a
 * recorded position, and that is the v0.61.0 failure mode in its purest form.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import Database from "better-sqlite3";
import { runPluginMigrations } from "../server/core-migrations.ts";
import { REWRITTEN_LEDGER_REPAIR } from "../lib/migration-ledger-heal.mjs";

const RECORDED = JSON.parse(
  readFileSync(new URL("./fixtures/migration-statement-hashes.json", import.meta.url), "utf8"),
);

/** The hash the host records, computed the way the host computes it. */
const statementHash = (statement) => createHash("sha256").update(statement).digest("hex");

/** The plugin's boot sequence, logged silently, running every statement for real. */
function quietHost(onMigrate) {
  return {
    log: { warn() {}, info() {}, error() {} },
    storage: {
      migrate: (database, statements) => {
        onMigrate?.(statements);
        for (const statement of statements) database.exec(statement);
      },
    },
  };
}

/**
 * The array the plugin actually hands the host, captured rather than imported:
 * `bb.storage.migrate` is the only door those statements leave through, so this
 * sees exactly what bb sees, including anything a future edit spreads in. The
 * statements are executed against a real database on the way, because the rest
 * of the boot sequence reads the tables they create.
 */
function captureMigratedStatements() {
  const db = new Database(":memory:");
  let captured;
  runPluginMigrations(quietHost((statements) => { captured = statements; }), db, () => 1);
  db.close();
  return captured;
}

test("every released migration statement still hashes to what shipped", () => {
  const statements = captureMigratedStatements();
  for (const { index, hash } of RECORDED) {
    const actual = statements[index];
    assert.notEqual(actual, undefined, `migration ${index} still exists in the statement list`);
    assert.equal(
      statementHash(actual),
      hash,
      `migration ${index} no longer hashes to the released statement. bb keys every recorded `
      + "migration by array index and refuses to start on any hash mismatch, so this breaks every "
      + "install that already recorded it. Append a new migration instead of editing a released one.",
    );
  }
});

test("no released position is missing from the statement list", () => {
  const statements = captureMigratedStatements();
  assert.equal(
    statements.length,
    RECORDED.length,
    `the plugin passes ${statements.length} statements and ${RECORDED.length} are recorded. A `
    + "shorter list shifts every later position onto the wrong record — that is the v0.61.0 "
    + "failure. Append to the end and add the entry here, never remove or reorder.",
  );
});

test("the recorded position 3 agrees with the shipped ledger repair", () => {
  const repair = REWRITTEN_LEDGER_REPAIR;
  const recorded = RECORDED.find((entry) => entry.index === repair.index);
  assert.equal(
    recorded?.hash,
    repair.shippedHash,
    `the repair rewrites position ${repair.index} to ${repair.shippedHash.slice(0, 8)}…, so the `
    + "recorded hash has to be that value or the repair declines and the host's refusal stands",
  );
});

test("the migrations still boot a fresh in-memory database twice over", () => {
  const db = new Database(":memory:");
  runPluginMigrations(quietHost(), db, () => 1);
  runPluginMigrations(quietHost(), db, () => 2);
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name);
  for (const name of ["cards", "comments", "presets", "card_presets", "expired_questions"]) {
    assert.equal(tables.includes(name), true, `${name} exists after a real migration run`);
  }
  db.close();
});
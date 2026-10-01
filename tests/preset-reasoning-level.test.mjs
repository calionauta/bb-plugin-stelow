/**
 * The preset reasoning level is a closed vocabulary, and every boundary that
 * touches it is a place a card could otherwise run at an effort nobody chose.
 *
 * The two halves of that claim are tested here rather than in the modules that
 * happen to implement them, because the failure is invisible from either side:
 * the picker's normaliser always showed `medium`, and the spawn site simply
 * forwarded whatever string it was handed.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import {
  asPresetReasoningLevel,
  isPresetReasoningLevel,
  PRESET_REASONING_LEVELS,
  DEFAULT_PRESET_REASONING_LEVEL,
} from "../lib/preset-reasoning-level.mjs";
import {
  sanitizeComposerExecution,
  resolveComposerSpawn,
} from "../lib/composer-execution.mjs";
import {
  PRESET_MIGRATION_STATEMENTS,
  PresetSchemaError,
  runPresetMigrations,
} from "../server/presets.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("only the eight host levels pass, and everything else reads as medium", () => {
  for (const level of PRESET_REASONING_LEVELS) {
    assert.equal(isPresetReasoningLevel(level), true, `${level} is a level`);
    assert.equal(asPresetReasoningLevel(level), level, `${level} survives normalisation`);
  }
  for (const value of ["banana", "", "HIGH", "medium-high", null, undefined, 7, {}]) {
    assert.equal(isPresetReasoningLevel(value), false, `${JSON.stringify(value) ?? value} is not a level`);
    assert.equal(
      asPresetReasoningLevel(value),
      DEFAULT_PRESET_REASONING_LEVEL,
      "an unusable level reads as the default, never as itself",
    );
  }
});

test("the vocabulary is the host's own, so a host that adds a level fails here", () => {
  const bundled = join(root, "node_modules/@get-bb/plugin-sdk/bundled-types");
  const declarations = readdirSync(bundled)
    .filter((name) => name.endsWith(".d.ts"))
    .map((name) => readFileSync(join(bundled, name), "utf8"))
    .filter((source) => source.includes("reasoningLevelSchema"));
  const host = new Set();
  for (const source of declarations) {
    const block = source.match(/reasoningLevelSchema:\s*\w*\.?ZodEnum<\{([^}]*)\}/);
    for (const match of (block?.[1] ?? "").matchAll(/\w+:\s*"([^"]+)"/g)) host.add(match[1]);
  }
  assert.ok(host.size > 0, "the SDK declares a reasoningLevelSchema");
  assert.deepEqual(
    [...PRESET_REASONING_LEVELS].sort(),
    [...host].sort(),
    "a preset stores exactly what the host can spawn — a new host level needs a decision here",
  );
});

test("a composer's level is validated against the same eight, so junk falls back to the preset", () => {
  assert.equal(
    sanitizeComposerExecution({ reasoningLevel: "banana" }),
    null,
    "a level no host will honour is not a choice at all",
  );
  assert.deepEqual(
    sanitizeComposerExecution({ providerId: "pi", reasoningLevel: "high" }),
    { providerId: "pi", reasoningLevel: "high" },
    "a real level survives next to the rest of the choice",
  );
  const base = { provider_id: "pi", model_id: "m", reasoning_level: "high", permission_mode: "full" };
  assert.equal(
    resolveComposerSpawn(base, { reasoningLevel: "banana" }).reasoningLevel,
    "high",
    "the preset's level fills the gap the junk level left, instead of the junk winning",
  );
});

/**
 * The current column order, written out rather than imported. A test that reads
 * the order off the implementation proves only that the implementation agrees
 * with itself, which is the drift this file exists to catch.
 */
const CURRENT_COLUMN_ORDER = [
  "id", "name", "provider_id", "model_id", "reasoning_level", "permission_mode",
  "environment_kind", "base_branch", "machine_id", "instructions", "is_default",
  "built_in", "created_at", "updated_at",
];

/** An empty database with only the tables a preset migration reads. */
function emptyDb() {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE cards (id TEXT PRIMARY KEY, worker_preset_id TEXT)");
  return db;
}

/** The shape a pre-0.61 install carries: no reasoning CHECK, three columns short. */
const LEGACY_PRESETS_DDL = `CREATE TABLE presets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  provider_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  reasoning_level TEXT NOT NULL,
  permission_mode TEXT NOT NULL CHECK (permission_mode IN ('accept-edits','auto','full')),
  instructions TEXT NOT NULL DEFAULT '',
  is_default INTEGER NOT NULL DEFAULT 0,
  built_in INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
)`;

const PRESETS_SQL = "SELECT sql FROM sqlite_master WHERE name = 'presets'";
// node:sqlite hands back null-prototype rows, so compare plain shapes.
const rows = (db, sql) => db.prepare(sql).all().map((row) => ({ ...row }));
const columnNames = (db) => rows(db, "PRAGMA table_info(presets)").map((column) => column.name);

/**
 * `assert.throws` proves a class was thrown but hands back nothing, and the
 * message is the part under test here — a refusal nobody can read is a refusal
 * nobody can act on. So assert the class, then return the error to inspect.
 */
function captureThrow(run, expected) {
  let caught;
  try {
    run();
  } catch (error) {
    caught = error;
  }
  assert.ok(caught, `expected ${expected.name} to be thrown, and nothing was`);
  assert.ok(
    caught instanceof expected,
    `expected ${expected.name}, got ${caught?.name}: ${caught?.message}`,
  );
  return caught;
}

function pinCard(db, presetId) {
  db.exec(`CREATE TABLE IF NOT EXISTS card_presets (
    card_id TEXT PRIMARY KEY, preset_id TEXT NOT NULL, assigned_at INTEGER NOT NULL,
    FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE,
    FOREIGN KEY (preset_id) REFERENCES presets(id) ON DELETE CASCADE)`);
  db.prepare("INSERT INTO cards VALUES ('card-1',?)").run(presetId);
  db.prepare("INSERT INTO card_presets VALUES ('card-1',?,5)").run(presetId);
}

test("a fresh install creates presets with the reasoning CHECK and the current column order", () => {
  const db = emptyDb();
  for (const statement of PRESET_MIGRATION_STATEMENTS) db.exec(statement);
  runPresetMigrations(db, () => 100);

  assert.deepEqual(
    columnNames(db),
    CURRENT_COLUMN_ORDER,
    "the columns are created in the order the shape assertion demands, not appended later",
  );
  assert.match(
    db.prepare(PRESETS_SQL).get().sql,
    /CHECK \(reasoning_level IN \('low'/,
    "a fresh install gets the CHECK from the DDL itself, so no migration is needed to add it",
  );
  assert.throws(
    () => db.exec(`INSERT INTO presets VALUES (
      'p_bad','Bad','pi','m','banana','full','project-default',NULL,NULL,'',0,0,1,1)`),
    /CHECK constraint failed/,
    "storage refuses a level no host will honour, whatever the caller believed",
  );
  assert.equal(
    db.prepare("SELECT provider_id FROM presets WHERE id = 'preset_default'").get().provider_id,
    "pi",
    "a fresh install is seeded with the default preset, because a card with no assigned preset resolves to it",
  );
  db.close();
});

test("running the migration again changes nothing at all", () => {
  const db = emptyDb();
  for (const statement of PRESET_MIGRATION_STATEMENTS) db.exec(statement);
  runPresetMigrations(db, () => 100);
  const sql = db.prepare(PRESETS_SQL).get().sql;
  const before = rows(db, "SELECT * FROM presets ORDER BY id");

  runPresetMigrations(db, () => 200);
  runPresetMigrations(db, () => 300);

  assert.equal(
    db.prepare(PRESETS_SQL).get().sql,
    sql,
    "a second and third boot do not rewrite the table: no rename, no rebuild, no drift in its DDL",
  );
  assert.deepEqual(
    rows(db, "SELECT * FROM presets ORDER BY id"),
    before,
    "no row is touched, added or dropped by a repeat boot, and the seed is not written twice",
  );
  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM presets WHERE id = 'preset_default'").get().count,
    1,
    "the built-in default is seeded once, however many times the plugin starts",
  );
  db.close();
});

test("a legacy-shaped presets table is refused by name, not crashed on and not accepted", () => {
  const db = emptyDb();
  db.exec(LEGACY_PRESETS_DDL);
  db.exec("INSERT INTO presets VALUES ('p_junk','Junk','pi','m','medium','full','',0,0,1,1)");
  pinCard(db, "p_junk");
  db.exec("PRAGMA foreign_keys=ON");

  // The previous migration answered this input by renaming the table, creating
  // a replacement, and copying positionally — which transposed the row and threw
  // `NOT NULL constraint failed: presets.created_at` *after* the rename, so the
  // boot died with an empty `presets` and the user's rows orphaned in
  // `presets_rebuild`. The refusal below has to arrive before anything is moved.
  assertRefusalIsActionable(captureThrow(() => runPresetMigrations(db, () => 100), PresetSchemaError));
  assertRefusalTouchedNothing(db);
  db.close();
});

/**
 * A refusal nobody can act on is a refusal nobody can act on, so the message
 * carries the diagnosis and the command — and never implies a forward migration
 * is coming, which is the promise this project no longer makes.
 */
function assertRefusalIsActionable(error) {
  assert.match(
    error.message,
    /CHECK \(reasoning_level IN/,
    "the refusal names the constraint the table is missing, so the operator can see what is wrong",
  );
  assert.match(
    error.message,
    /ALTER TABLE presets RENAME TO presets_legacy/,
    "the refusal names the command that unblocks the boot",
  );
  assert.match(
    error.message,
    /will not start/,
    "the refusal says the plugin stops, rather than warning and carrying on degraded",
  );
  assert.doesNotMatch(
    error.message,
    /will be migrated|upgraded automatically|bringing (it|your) forward/,
    "an unsupported install is never described as something that will be brought forward",
  );
}

/**
 * The old migration renamed first and copied second, so the transposition threw
 * after the rename: `presets` was left empty and the operator's row stranded in
 * `presets_rebuild`. Every one of these asserts the refusal arrives before
 * anything moves.
 */
function assertRefusalTouchedNothing(db) {
  const kept = rows(db, "SELECT * FROM presets");
  assert.equal(
    kept.length,
    1,
    "the user's preset survives the refusal, which the old crash did not manage",
  );
  assert.equal(
    kept[0].id,
    "p_junk",
    "the legacy rows are left exactly as they were: refusing is not deleting",
  );
  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE name = 'presets_rebuild'").get().count,
    0,
    "nothing was renamed aside, so there is no half-migrated table left behind",
  );
  assert.deepEqual(
    rows(db, "PRAGMA foreign_key_check"),
    [],
    "the card pin still resolves, because the child table was never repointed",
  );
}

test("a table that carries the CHECK but the wrong column order is refused too", () => {
  const db = emptyDb();
  // The order is the half that transposed a row, so the marker alone does not
  // prove the shape. Every column is present and the CHECK is there; only the
  // order is a legacy one, which is what a positional copy would misread.
  const reordered = [
    "id TEXT PRIMARY KEY", "name TEXT NOT NULL UNIQUE COLLATE NOCASE",
    "provider_id TEXT NOT NULL", "model_id TEXT NOT NULL",
    "reasoning_level TEXT NOT NULL CHECK (reasoning_level IN ('low','medium'))",
    "permission_mode TEXT NOT NULL",
    "instructions TEXT NOT NULL DEFAULT ''", "is_default INTEGER NOT NULL DEFAULT 0",
    "built_in INTEGER NOT NULL DEFAULT 0", "created_at INTEGER NOT NULL",
    "updated_at INTEGER NOT NULL", "environment_kind TEXT NOT NULL DEFAULT 'project-default'",
    "base_branch TEXT", "machine_id TEXT",
  ];
  db.exec(`CREATE TABLE presets (${reordered.join(",\n")})`);

  const error = captureThrow(() => runPresetMigrations(db, () => 100), PresetSchemaError);
  assert.match(error.message, /its columns are \(/, "the refusal reports the order it found");
  assert.match(error.message, /environment_kind/, "and names the column that is out of place");
  db.close();
});

test("a correctly-shaped table with data keeps every row, across two migrations", () => {
  const db = emptyDb();
  for (const statement of PRESET_MIGRATION_STATEMENTS) db.exec(statement);
  db.exec(`INSERT INTO presets VALUES (
    'p_one','One','pi','m','high','full','new-worktree','main','host-a','do the thing',
    0,0,111,222)`);
  db.exec(`INSERT INTO presets VALUES (
    'p_two','Two','pi','m','low','accept-edits','project-default',NULL,NULL,'',1,0,333,444)`);
  // A default preset an operator has edited. The migrations this branch deleted
  // rewrote exactly this row on every boot: provider codex was repointed at pi,
  // and any pi default with a non-full permission_mode was stamped back to
  // 'full'. Both silently undid a setting the operator had chosen, on an install
  // that was otherwise perfectly current.
  db.exec(`INSERT INTO presets VALUES (
    'preset_default','Default','codex','gpt-5-codex','high','accept-edits',
    'project-default',NULL,NULL,'',1,1,100,100)`);
  pinCard(db, "p_one");
  db.exec("PRAGMA foreign_keys=ON");
  // The authored rows only: the default preset is asserted separately, because
  // this install already has one and the interesting claim is that it is not
  // touched, rather than that a missing one is seeded.
  const authored = "SELECT * FROM presets WHERE id != 'preset_default' ORDER BY id";
  const expected = rows(db, authored);

  runPresetMigrations(db, () => 100);
  assert.deepEqual(
    rows(db, authored),
    expected,
    "user-authored presets survive the migration row for row, environment_kind included",
  );

  runPresetMigrations(db, () => 200);
  assert.deepEqual(
    rows(db, authored),
    expected,
    "and survive the second run, so a repeated boot is not a slow data loss",
  );
  assertExistingDefaultIsUntouched(db);
  assertPinsIntact(db);
  db.close();
});

/**
 * The two migrations deleted with the rebuild existed to rewrite this row, so
 * their absence is the claim: an install that already had a default keeps the
 * provider and permission mode the operator chose, on every boot.
 */
function assertExistingDefaultIsUntouched(db) {
  assert.deepEqual(
    rows(db, "SELECT provider_id, model_id, reasoning_level, permission_mode"
      + " FROM presets WHERE id = 'preset_default'"),
    [{ provider_id: "codex", model_id: "gpt-5-codex", reasoning_level: "high", permission_mode: "accept-edits" }],
    "an existing default preset is left exactly as the operator set it, boot after boot: "
      + "no migration repoints its provider and none stamps its permission mode back",
  );
}

function assertPinsIntact(db) {
  assert.deepEqual(
    rows(db, "SELECT card_id, preset_id FROM card_presets"),
    [{ card_id: "card-1", preset_id: "p_one" }],
    "a card pinned to a preset is still pinned to it",
  );
  assert.deepEqual(rows(db, "PRAGMA foreign_key_check"), [], "and the pin still resolves");
}

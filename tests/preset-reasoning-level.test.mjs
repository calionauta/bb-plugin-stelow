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

/** A presets table carrying a row written before the level vocabulary was closed. */
function legacyPresets() {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE cards (id TEXT PRIMARY KEY, worker_preset_id TEXT)");
  for (const statement of PRESET_MIGRATION_STATEMENTS) db.exec(statement);
  db.exec("INSERT INTO presets VALUES ('p_junk','Junk','pi','m','banana','full','project-default',NULL,NULL,'',0,0,1,1)");
  db.exec("INSERT INTO cards VALUES ('card-1','p_junk')");
  db.exec("INSERT INTO card_presets VALUES ('card-1','p_junk',5)");
  db.exec("PRAGMA foreign_keys=ON");
  return db;
}

test("the migration repairs a legacy level, keeps every card pin, and refuses junk afterwards", () => {
  const db = legacyPresets();
  runPresetMigrations(db, () => 100);

  assert.equal(
    db.prepare("SELECT reasoning_level FROM presets WHERE id = 'p_junk'").get().reasoning_level,
    "medium",
    "a level the host cannot spawn is repaired to the level the picker was already showing",
  );
  // node:sqlite hands back null-prototype rows, so compare plain shapes.
  const rows = (sql) => db.prepare(sql).all().map((row) => ({ ...row }));
  assert.deepEqual(
    rows("PRAGMA foreign_key_check"),
    [],
    "the rebuild must not repoint the children's foreign keys at the temp table",
  );
  assert.deepEqual(
    rows("SELECT card_id, preset_id FROM card_presets"),
    [{ card_id: "card-1", preset_id: "p_junk" }],
    "a card pinned to a repaired preset is still pinned to it",
  );
  assert.throws(
    () => db.exec("INSERT INTO presets VALUES ('p_bad','Bad','pi','m','banana','full','project-default',NULL,NULL,'',0,0,1,1)"),
    /CHECK constraint failed/,
    "storage refuses a level no host will honour, whatever the caller believed",
  );

  const before = db.prepare("SELECT COUNT(*) AS count FROM presets").get().count;
  assert.doesNotThrow(() => runPresetMigrations(db, () => 200), "migrations stay idempotent");
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM presets").get().count, before);
  db.close();
});
import type { PresetDb, PresetRow } from "./preset-contracts.js";
import { PRESET_REASONING_LEVELS } from "../lib/preset-reasoning-level.mjs";

/**
 * `presets` rebuilt with the reasoning-level CHECK. `ALTER TABLE … ADD
 * CONSTRAINT` is a syntax error in SQLite, so the column constraint can only
 * arrive by rebuilding the table — hence a second definition of the schema
 * that has to track the one in `PRESET_MIGRATION_STATEMENTS`.
 */
const PRESETS_WITH_REASONING_CHECK = `CREATE TABLE presets (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE COLLATE NOCASE,
      provider_id TEXT NOT NULL,
      model_id TEXT NOT NULL,
      reasoning_level TEXT NOT NULL CHECK (reasoning_level IN (${levelList()})),
      permission_mode TEXT NOT NULL CHECK (permission_mode IN ('accept-edits','auto','full')),
      environment_kind TEXT NOT NULL DEFAULT 'project-default' CHECK (environment_kind IN ('project-default','new-worktree')),
      base_branch TEXT,
      machine_id TEXT,
      instructions TEXT NOT NULL DEFAULT '',
      is_default INTEGER NOT NULL DEFAULT 0,
      built_in INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`;

export const PRESET_MIGRATION_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS presets (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE COLLATE NOCASE,
      provider_id TEXT NOT NULL,
      model_id TEXT NOT NULL,
      reasoning_level TEXT NOT NULL,
      permission_mode TEXT NOT NULL CHECK (permission_mode IN ('accept-edits','auto','full')),
      environment_kind TEXT NOT NULL DEFAULT 'project-default' CHECK (environment_kind IN ('project-default','new-worktree')),
      base_branch TEXT,
      machine_id TEXT,
      instructions TEXT NOT NULL DEFAULT '',
      is_default INTEGER NOT NULL DEFAULT 0,
      built_in INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
  `CREATE TABLE IF NOT EXISTS card_presets (
      card_id TEXT PRIMARY KEY,
      preset_id TEXT NOT NULL,
      assigned_at INTEGER NOT NULL,
      FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE,
      FOREIGN KEY (preset_id) REFERENCES presets(id) ON DELETE CASCADE
    )`,
];

function levelList(): string {
  return PRESET_REASONING_LEVELS.map((level) => `'${level}'`).join(",");
}

export function runPresetMigrations(db: PresetDb, now: () => number): void {
  ensurePresetTables(db);
  addMissingColumns(db);
  rebuildReasoningLevelCheck(db);
  ensureDefaultPreset(db, now);
  db.prepare("DELETE FROM presets WHERE built_in = 0 AND provider_id = 'codex'").run();
}

/**
 * Refuse an out-of-enum reasoning level at the storage layer, so no writer —
 * RPC, CLI, composer override, or a future one — can persist a level the host
 * cannot spawn.
 *
 * Three details are load-bearing and each was measured, not reasoned about:
 *
 * 1. `legacy_alter_table=ON`. Without it, `ALTER TABLE … RENAME TO` rewrites
 *    the children's foreign keys to the temp table's name, so
 *    `foreign_key_check` reports `parent: presets_rebuild` for every card pin
 *    and cascade deletes stop resolving against `presets`.
 * 2. The repair UPDATE runs *before* the rebuild: `INSERT … SELECT` aborts on a
 *    legacy junk row the moment the CHECK exists. Repair is invisible because
 *    `medium` is what the picker already displays for such a row.
 * 3. The rebuild is idempotence-gated on the existing table SQL, the same
 *    guard shape as `rebuildLegacyBandTable`.
 */
function rebuildReasoningLevelCheck(db: PresetDb): void {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'presets'")
    .get() as { sql: string } | undefined;
  if (row?.sql.includes("CHECK (reasoning_level IN")) return;
  db.exec(`PRAGMA foreign_keys=OFF;
    PRAGMA legacy_alter_table=ON;
    UPDATE presets SET reasoning_level = 'medium'
      WHERE reasoning_level NOT IN (${levelList()});
    ALTER TABLE presets RENAME TO presets_rebuild;
    ${PRESETS_WITH_REASONING_CHECK};
    INSERT INTO presets SELECT * FROM presets_rebuild;
    DROP TABLE presets_rebuild;
    PRAGMA legacy_alter_table=OFF;
    PRAGMA foreign_keys=ON;`);
}

function ensurePresetTables(db: PresetDb): void {
  db.exec(`CREATE TABLE IF NOT EXISTS stage_presets (
    band TEXT PRIMARY KEY,
    preset_id TEXT NOT NULL,
    assigned_at INTEGER NOT NULL,
    FOREIGN KEY (preset_id) REFERENCES presets(id) ON DELETE CASCADE
  )`);
  for (const table of ["review_preset", "generation_preset", "reliable_preset"] as const) {
    db.exec(`CREATE TABLE IF NOT EXISTS ${table} (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      preset_id TEXT NOT NULL,
      assigned_at INTEGER NOT NULL,
      FOREIGN KEY (preset_id) REFERENCES presets(id) ON DELETE CASCADE
    )`);
  }
  rebuildLegacyBandTable(db);
}

function addMissingColumns(db: PresetDb): void {
  const columns = db.prepare("PRAGMA table_info(presets)").all() as Array<{ name: string }>;
  const additions = [
    ["environment_kind", "TEXT NOT NULL DEFAULT 'project-default'"],
    ["base_branch", "TEXT"],
    ["machine_id", "TEXT"],
  ];
  for (const [name, definition] of additions) {
    if (!columns.some((column) => column.name === name)) {
      db.exec(`ALTER TABLE presets ADD COLUMN ${name} ${definition}`);
    }
  }
}

function rebuildLegacyBandTable(db: PresetDb): void {
  const row = db.prepare(
    "SELECT sql FROM sqlite_master WHERE name = 'stage_presets'",
  ).get() as { sql: string } | undefined;
  if (!row?.sql.includes("CHECK (band IN")) return;
  db.exec(`ALTER TABLE stage_presets RENAME TO stage_presets_rebuild;
    CREATE TABLE stage_presets (
      band TEXT PRIMARY KEY,
      preset_id TEXT NOT NULL,
      assigned_at INTEGER NOT NULL,
      FOREIGN KEY (preset_id) REFERENCES presets(id) ON DELETE CASCADE
    );
    INSERT INTO stage_presets (band, preset_id, assigned_at)
      SELECT band, preset_id, assigned_at FROM stage_presets_rebuild;
    DROP TABLE stage_presets_rebuild;`);
}

function ensureDefaultPreset(db: PresetDb, now: () => number): void {
  const existing = db.prepare("SELECT * FROM presets WHERE id = 'preset_default'")
    .get() as PresetRow | undefined;
  if (existing?.provider_id === "codex") {
    migrateCodexDefault(db, now());
  } else if (existing && existing.permission_mode !== "full" && existing.provider_id === "pi") {
    migratePiDefault(db, now());
  } else if (!existing) {
    insertDefaultPreset(db, now);
  }
}

function migrateCodexDefault(db: PresetDb, timestamp: number): void {
  db.prepare(`
    UPDATE presets
    SET provider_id = 'pi', model_id = 'bifrost/harness-coding',
        permission_mode = 'full', updated_at = ?
    WHERE id = 'preset_default'
  `).run(timestamp);
}

function migratePiDefault(db: PresetDb, timestamp: number): void {
  db.prepare(`
    UPDATE presets SET permission_mode = 'full', updated_at = ?
    WHERE id = 'preset_default'
  `).run(timestamp);
}

function insertDefaultPreset(db: PresetDb, now: () => number): void {
  db.prepare(`INSERT INTO presets (
    id, name, provider_id, model_id, reasoning_level, permission_mode,
    environment_kind, instructions, is_default, built_in, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    "preset_default", "Default", "pi", "bifrost/harness-coding", "medium",
    "full", "project-default", "", 1, 1, now(), now(),
  );
}

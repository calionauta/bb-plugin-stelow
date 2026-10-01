import type { PresetDb, PresetRow } from "./preset-contracts.js";
import { PRESET_REASONING_LEVELS } from "../lib/preset-reasoning-level.mjs";

/**
 * The one owner of the `presets` shape.
 *
 * Column name and DDL live in a single ordered list, and the table, the
 * idempotence marker and the shape assertion are all derived from it. That is
 * the whole point: the previous file carried a second, hand-written copy of
 * this DDL for its table rebuild, the two drifted, and the drift was invisible
 * until a legacy row was copied positionally into the wrong columns.
 */
const PRESET_COLUMNS: ReadonlyArray<readonly [name: string, ddl: string]> = [
  ["id", "TEXT PRIMARY KEY"],
  ["name", "TEXT NOT NULL UNIQUE COLLATE NOCASE"],
  ["provider_id", "TEXT NOT NULL"],
  ["model_id", "TEXT NOT NULL"],
  [
    "reasoning_level",
    // Refuse an out-of-enum level at the storage layer, so no writer — RPC,
    // CLI, composer override, or a future one — can persist a level the host
    // cannot spawn. `assertSpawnableReasoningLevel` in preset-handler-crud
    // refuses the same value at the door; this is the backstop under it.
    `TEXT NOT NULL CHECK (reasoning_level IN (${levelList()}))`,
  ],
  [
    "permission_mode",
    "TEXT NOT NULL CHECK (permission_mode IN ('accept-edits','auto','full'))",
  ],
  [
    "environment_kind",
    "TEXT NOT NULL DEFAULT 'project-default' "
      + "CHECK (environment_kind IN ('project-default','new-worktree'))",
  ],
  ["base_branch", "TEXT"],
  ["machine_id", "TEXT"],
  ["instructions", "TEXT NOT NULL DEFAULT ''"],
  ["is_default", "INTEGER NOT NULL DEFAULT 0"],
  ["built_in", "INTEGER NOT NULL DEFAULT 0"],
  ["created_at", "INTEGER NOT NULL"],
  ["updated_at", "INTEGER NOT NULL"],
];

const PRESET_COLUMN_ORDER = PRESET_COLUMNS.map(([name]) => name);

/** A marker only the current DDL emits, so the assertion cannot drift from it. */
const REASONING_CHECK_MARKER = "CHECK (reasoning_level IN";

/**
 * The whole migration, for a fresh install and for an install that already has
 * the table. `IF NOT EXISTS` makes the second case a no-op that touches no row,
 * which is why no data-preserving copy of any kind is needed here.
 */
const PRESETS_DDL = `CREATE TABLE IF NOT EXISTS presets (
  ${PRESET_COLUMNS.map(([name, ddl]) => `${name} ${ddl}`).join(",\n  ")}
)`;

export const PRESET_MIGRATION_STATEMENTS = [
  PRESETS_DDL,
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

/**
 * A named refusal, not a repair.
 *
 * Stelow does not maintain backward compatibility, so an install whose
 * `presets` table predates this schema is simply unsupported. The one thing
 * that must not happen is degrading into plausible-looking behaviour, so the
 * boot stops here — before `ensureDefaultPreset` writes anything, and long
 * before a card resolves a preset and fails to spawn.
 *
 * The advice is deliberately non-destructive. Presets are user-authored
 * configuration, so the fix is to move the old table aside, not to drop it:
 * the plugin then creates the current table on the next start, and the rows
 * stay in `presets_legacy` to re-import by name.
 */
export class PresetSchemaError extends Error {
  constructor(problem: string) {
    super(
      `Stelow will not start: the \`presets\` table is not the current shape — ${problem}. `
        + "Stelow no longer migrates this table, and presets are user-authored configuration, "
        + "so nothing is repaired or dropped for you. To unblock, stop bb and move the old table "
        + "aside in your Stelow data.db; the current table is then created on the next start, and "
        + 'your presets stay in `presets_legacy` to re-import by name:\n'
        + '  sqlite3 data.db "ALTER TABLE presets RENAME TO presets_legacy"',
    );
    this.name = "PresetSchemaError";
  }
}

export function runPresetMigrations(db: PresetDb, now: () => number): void {
  assertPresetsShape(db);
  ensurePresetTables(db);
  ensureDefaultPreset(db, now);
}

/**
 * `CREATE TABLE IF NOT EXISTS` leaves an existing table exactly as it is, so a
 * table from an unsupported install would otherwise survive boot with the wrong
 * column order and no reasoning CHECK — and every later read and write of it
 * would look like it worked. Assert the shape the current DDL guarantees.
 *
 * Two conditions, because the column order is the half that actually bit: a
 * legacy table gains new columns by `ALTER TABLE … ADD COLUMN`, which appends,
 * so a positional copy transposes the row and throws
 * `NOT NULL constraint failed: presets.created_at` — after the rename, leaving
 * `presets` empty and the user's rows orphaned in `presets_rebuild`.
 */
function assertPresetsShape(db: PresetDb): void {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'presets'")
    .get() as { sql: string } | undefined;
  if (!row) return;
  if (!row.sql.includes(REASONING_CHECK_MARKER)) {
    throw new PresetSchemaError(`it carries no \`${REASONING_CHECK_MARKER} …)\` constraint`);
  }
  const present = (db.prepare("PRAGMA table_info(presets)").all() as Array<{ name: string }>)
    .map((column) => column.name);
  if (present.join(",") !== PRESET_COLUMN_ORDER.join(",")) {
    throw new PresetSchemaError(
      `its columns are (${present.join(", ")}), not (${PRESET_COLUMN_ORDER.join(", ")})`,
    );
  }
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

/**
 * The built-in default has to exist, because a card with no assigned preset
 * resolves to it — so a fresh install is seeded. An existing row is left
 * exactly as it is: it is a preset the operator can edit, and a migration that
 * rewrote it on every boot would silently undo the edit.
 */
function ensureDefaultPreset(db: PresetDb, now: () => number): void {
  const existing = db.prepare("SELECT id FROM presets WHERE id = 'preset_default'")
    .get() as Pick<PresetRow, "id"> | undefined;
  if (existing) return;
  db.prepare(`INSERT INTO presets (
    id, name, provider_id, model_id, reasoning_level, permission_mode,
    environment_kind, instructions, is_default, built_in, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    "preset_default", "Default", "pi", "bifrost/harness-coding", "medium",
    "full", "project-default", "", 1, 1, now(), now(),
  );
}

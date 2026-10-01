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

/**
 * The recorded ledger, and it must never change.
 *
 * `PRESET_MIGRATION_STATEMENTS` is spread into the single `bb.storage.migrate`
 * list in `core-migrations.ts`, and the host records a sha256 per STATEMENT at
 * the position it occupied, refusing to start when a recorded position's
 * statement no longer hashes the same. So this array is append-only and
 * order-frozen: changing the text of an entry, or moving one, breaks every
 * install that already recorded it — not just the ones carrying old data,
 * because the record is a hash of the STATEMENT, not of the schema on disk.
 *
 * Measured on this host's live ledger, which is what caught it. Positions 3
 * and 4 hold `ba1ac500…` (the `presets` DDL) and `dc61626f…` (`card_presets`).
 * A first attempt at this change rewrote the `presets` entry as a template
 * literal, which both changed its text and — by emitting only one entry —
 * pulled `card_presets` up into position 3, so the host compared `dc61626f…`
 * against a record of `ba1ac500…` and refused every install with "migration 3
 * does not match the recorded statement". That message reads like a corrupt
 * database; it is an unchanged array being reordered.
 *
 * So the array below is the RELEASED text, in the RELEASED order, and the
 * current `presets` shape is reached outside it — see `ensureCurrentPresets`.
 * The `presets` DDL here stays deliberately behind the current one, and that
 * is the point: it is a record, not a schema.
 */
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
  ensureCurrentPresets(db);
  assertPresetsShape(db);
  ensurePresetTables(db);
  ensureDefaultPreset(db, now);
}

/**
 * Bring the `presets` table to the current shape, outside the recorded ledger.
 *
 * The recorded list cannot carry the current DDL (see the note on
 * `PRESET_MIGRATION_STATEMENTS`), so the table the ledger creates is brought
 * forward here. Two cases, and the distinction is whether there is anything to
 * lose:
 *
 * - the table does not exist, or exists EMPTY. There is no data to preserve, so
 *   the old shape is dropped and the current one created. This is the fresh
 *   install and the "no presets configured yet" install, and it is why a fresh
 *   install gets the reasoning CHECK from the DDL rather than needing a repair.
 * - the table exists with rows. It is left exactly as it is and
 *   `assertPresetsShape` refuses, because copying rows out of a table whose
 *   column order is not the current one is what destroyed data before — the
 *   positional copy transposed the row and threw AFTER the rename. No backward
 *   compatibility means no repair; the operator moves the table aside.
 *
 * Runs before the assertion so a fresh install has a current table to assert,
 * and after the ledger so an existing table is seen however it was created.
 */
function ensureCurrentPresets(db: PresetDb): void {
  const existing = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'presets'")
    .get() as { sql: string } | undefined;
  if (existing && !isCurrentPresetsDdl(existing.sql)) {
    const rows = (db.prepare("SELECT COUNT(*) AS count FROM presets").get() as { count: number }).count;
    if (rows > 0) return; // refused by the assertion, deliberately, with its rows intact
    db.exec("DROP TABLE presets");
  }
  db.exec(PRESETS_DDL);
}

/**
 * Whether a stored `presets` DDL is already the current one, decided by the
 * marker the current DDL carries rather than by a string comparison of the
 * whole statement — the same reason `assertPresetsShape` checks the CHECK
 * instead of diffing DDL, since `sqlite_master` reformats what it stores.
 */
function isCurrentPresetsDdl(sql: string): boolean {
  return sql.includes(REASONING_CHECK_MARKER);
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

import type { PresetAccessors } from "./preset-accessors.js";
import type {
  PresetRow,
  PresetServerDeps,
  PresetUpsertInput,
} from "./preset-contracts.js";

export function createPresetCrudHandlers(
  deps: PresetServerDeps,
  accessors: PresetAccessors,
) {
  const { db, now } = deps;
  const listPresets = createPresetListHandler(db);

  async function upsertPreset(input: PresetUpsertInput) {
    const trimmed = input.name.trim();
    if (!trimmed) throw new Error("Preset name is required.");
    const id = input.id || `preset_${Math.random().toString(36).slice(2, 10)}`;
    const collision = db.prepare(`
      SELECT id FROM presets WHERE LOWER(name) = LOWER(?) AND id != ?
    `).get(trimmed, id);
    if (collision) throw new Error(`A preset named "${trimmed}" already exists.`);
    if (input.id === null && id === "preset_default") {
      throw new Error("Built-in presets cannot be replaced.");
    }
    const existing = db.prepare("SELECT built_in FROM presets WHERE id = ?")
      .get(id) as { built_in: number } | undefined;
    if (existing?.built_in === 1 && input.id !== id) {
      throw new Error("Built-in presets cannot be renamed or duplicated; create a new one instead.");
    }
    writePreset(db, input, trimmed, id, now());
    return { preset: { id, name: trimmed } };
  }

  async function deletePreset({ id }: { id: string }) {
    const row = db.prepare("SELECT built_in FROM presets WHERE id = ?")
      .get(id) as { built_in: number } | undefined;
    if (!row) return { deleted: false, error: deps.errors.presetNotFound };
    if (row.built_in === 1) {
      return { deleted: false, error: "Built-in presets cannot be deleted." };
    }
    const inUse = countCardAssignments(db, id);
    if (inUse > 0) {
      return { deleted: false, error: `Preset is assigned to ${inUse} card(s). Unassign first.` };
    }
    db.prepare("DELETE FROM presets WHERE id = ?").run(id);
    accessors.refreshLiveWorkers(null);
    return { deleted: true, error: null };
  }

  return { listPresets, upsertPreset, deletePreset };
}

function createPresetListHandler(db: PresetServerDeps["db"]) {
  return async () => {
    const rows = db.prepare(`
      SELECT * FROM presets WHERE id NOT LIKE 'card-override-%'
      ORDER BY is_default DESC, name COLLATE NOCASE ASC
    `).all() as PresetRow[];
    return { presets: rows.map(publicPreset) };
  };
}

function countCardAssignments(db: PresetServerDeps["db"], id: string): number {
  const row = db.prepare(
    "SELECT COUNT(*) AS count FROM card_presets WHERE preset_id = ?",
  ).get(id) as { count: number };
  return row.count;
}

function writePreset(
  db: PresetServerDeps["db"],
  input: PresetUpsertInput,
  name: string,
  id: string,
  timestamp: number,
): void {
  const values = [
    name,
    input.providerId,
    input.modelId,
    input.reasoningLevel,
    input.permissionMode,
    input.environmentKind,
    input.baseBranch ?? null,
    input.machineId ?? null,
    input.instructions,
  ];
  if (db.prepare("SELECT id FROM presets WHERE id = ?").get(id)) {
    db.prepare(`
      UPDATE presets SET name = ?, provider_id = ?, model_id = ?,
        reasoning_level = ?, permission_mode = ?, environment_kind = ?,
        base_branch = ?, machine_id = ?, instructions = ?, updated_at = ?
      WHERE id = ?
    `).run(...values, timestamp, id);
    return;
  }
  db.prepare(`
    INSERT INTO presets (
      id, name, provider_id, model_id, reasoning_level, permission_mode,
      environment_kind, base_branch, machine_id, instructions, is_default,
      built_in, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?)
  `).run(id, ...values, timestamp, timestamp);
}

function publicPreset(row: PresetRow) {
  return {
    id: row.id,
    name: row.name,
    providerId: row.provider_id,
    modelId: row.model_id,
    reasoningLevel: row.reasoning_level,
    permissionMode: row.permission_mode,
    environmentKind: row.environment_kind,
    baseBranch: row.base_branch,
    machineId: row.machine_id,
    instructions: row.instructions,
    isDefault: row.is_default === 1,
    builtIn: row.built_in === 1,
  };
}

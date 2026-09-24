import { STAGE_BANDS } from "../lib/workflow-vocabulary.mjs";
import { refreshRestartPending } from "../lib/worker-ledger.mjs";
import type { PresetAccessors } from "./preset-accessors.js";
import type {
  PresetRow,
  PresetServerDeps,
  PresetUpsertInput,
  SingletonPresetTable,
} from "./preset-contracts.js";

export function createPresetHandlers(
  deps: PresetServerDeps,
  accessors: PresetAccessors,
) {
  const { db, bb, now } = deps;

  async function listPresets() {
    const rows = db.prepare(`
      SELECT * FROM presets WHERE id NOT LIKE 'card-override-%'
      ORDER BY is_default DESC, name COLLATE NOCASE ASC
    `).all() as PresetRow[];
    return { presets: rows.map(publicPreset) };
  }

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
    const inUse = countCardAssignments(id);
    if (inUse > 0) {
      return { deleted: false, error: `Preset is assigned to ${inUse} card(s). Unassign first.` };
    }
    db.prepare("DELETE FROM presets WHERE id = ?").run(id);
    accessors.refreshLiveWorkers(null);
    return { deleted: true, error: null };
  }

  async function listBandPresets() {
    const rows = db.prepare("SELECT band, preset_id FROM stage_presets")
      .all() as Array<{ band: string; preset_id: string }>;
    const map = new Map(rows.map((row) => [row.band, row.preset_id]));
    return {
      bands: Object.keys(STAGE_BANDS).map((band) => ({
        band,
        presetId: map.get(band) ?? null,
        stages: STAGE_BANDS[band],
      })),
    };
  }

  async function setBandPreset({ band, presetId }: BandPresetInput) {
    if (!STAGE_BANDS[band]) return { ok: false, error: `Unknown band: ${band}` };
    if (presetId) {
      if (!accessors.getPresetById(presetId)) {
        return { ok: false, error: deps.errors.presetNotFound };
      }
      db.prepare(`
        INSERT OR REPLACE INTO stage_presets (band, preset_id, assigned_at)
        VALUES (?, ?, ?)
      `).run(band, presetId, now());
    } else {
      db.prepare("DELETE FROM stage_presets WHERE band = ?").run(band);
    }
    accessors.refreshLiveWorkers([band]);
    return { ok: true, error: null };
  }

  async function assignPreset({ cardId, presetId }: CardPresetInput) {
    const card = deps.getCard(cardId);
    if (!card) return { ok: false, error: deps.errors.cardNotFound };
    if (presetId === null) {
      accessors.removeCardPreset(cardId);
    } else if (!accessors.pinCardPreset(cardId, presetId)) {
      return { ok: false, error: deps.errors.presetNotFound };
    } else {
      refreshRestartPending(
        db,
        card.id,
        card.worker_thread_id,
        card.worker_preset_id,
        presetId,
      );
    }
    bb.realtime.publish("card-state", { cardId });
    return { ok: true, error: null };
  }

  async function setDefaultPreset({ id }: { id: string }) {
    if (!accessors.getPresetById(id)) {
      return { ok: false, error: deps.errors.presetNotFound };
    }
    db.prepare("UPDATE presets SET is_default = 0").run();
    db.prepare("UPDATE presets SET is_default = 1 WHERE id = ?").run(id);
    bb.realtime.publish("board-changed", { presetId: id });
    return { ok: true, error: null };
  }

  function designate(table: SingletonPresetTable, presetId: string | null) {
    const failure = assignSingleton(table, presetId);
    if (failure) return failure;
    if (table === "reliable_preset") accessors.refreshLiveWorkers(null);
    bb.realtime.publish("board-changed", { presetId });
    return { ok: true, error: null };
  }

  function assignSingleton(table: SingletonPresetTable, presetId: string | null) {
    if (presetId) {
      if (!accessors.getPresetById(presetId)) {
        return { ok: false as const, error: deps.errors.presetNotFound };
      }
      db.prepare(`
        INSERT OR REPLACE INTO ${table} (id, preset_id, assigned_at)
        VALUES (1, ?, ?)
      `).run(presetId, now());
    } else {
      db.prepare(`DELETE FROM ${table} WHERE id = 1`).run();
    }
    return null;
  }

  function readSingleton(table: SingletonPresetTable) {
    const id = accessors.getSingletonPresetId(table);
    const row = id ? accessors.getPresetById(id) : null;
    return { preset: row ? singletonView(row) : null };
  }

  function countCardAssignments(id: string): number {
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

  return {
    listPresets,
    upsertPreset,
    deletePreset,
    listBandPresets,
    setBandPreset,
    getReviewPreset: async () => readSingleton("review_preset"),
    assignReviewPreset: async ({ presetId }: SingletonInput) =>
      designate("review_preset", presetId),
    getGenerationPreset: async () => readSingleton("generation_preset"),
    assignGenerationPreset: async ({ presetId }: SingletonInput) =>
      designate("generation_preset", presetId),
    getReliablePreset: async () => readSingleton("reliable_preset"),
    assignReliablePreset: async ({ presetId }: SingletonInput) =>
      designate("reliable_preset", presetId),
    assignPreset,
    setDefaultPreset,
  };
}

type BandPresetInput = { band: string; presetId: string | null };
type CardPresetInput = { cardId: string; presetId: string | null };
type SingletonInput = { presetId: string | null };

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

function singletonView(preset: PresetRow) {
  return {
    id: preset.id,
    name: preset.name,
    providerId: preset.provider_id,
    modelId: preset.model_id,
    reasoningLevel: preset.reasoning_level,
    permissionMode: preset.permission_mode,
  };
}

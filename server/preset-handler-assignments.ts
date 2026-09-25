import { STAGE_BANDS } from "../lib/workflow-vocabulary.mjs";
import { refreshRestartPending } from "../lib/worker-ledger.mjs";
import type { PresetAccessors } from "./preset-accessors.js";
import type {
  PresetRow,
  PresetServerDeps,
  SingletonPresetTable,
} from "./preset-contracts.js";

type BandPresetInput = { band: string; presetId: string | null };
type CardPresetInput = { cardId: string; presetId: string | null };
type SingletonInput = { presetId: string | null };

export function createPresetAssignmentHandlers(
  deps: PresetServerDeps,
  accessors: PresetAccessors,
  refreshReliable: (table: SingletonPresetTable, accessors: PresetAccessors) => void,
) {
  const stages = createStageHandlers(deps, accessors);
  const cards = createCardHandlers(deps, accessors);
  const singletons = createSingletonHandlers(deps, accessors, refreshReliable);
  return { ...stages, ...cards, ...singletons };
}

function createStageHandlers(deps: PresetServerDeps, accessors: PresetAccessors) {
  const { db, now } = deps;
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
  return { listBandPresets, setBandPreset };
}

function createCardHandlers(deps: PresetServerDeps, accessors: PresetAccessors) {
  const { db, bb } = deps;
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
  return { assignPreset, setDefaultPreset };
}

function createSingletonHandlers(
  deps: PresetServerDeps,
  accessors: PresetAccessors,
  refreshReliable: (table: SingletonPresetTable, accessors: PresetAccessors) => void,
) {
  const { db, bb, now } = deps;
  const designate = (table: SingletonPresetTable, presetId: string | null) => {
    const failure = assignSingleton(table, presetId);
    if (failure) return failure;
    refreshReliable(table, accessors);
    bb.realtime.publish("board-changed", { presetId });
    return { ok: true, error: null };
  };
  function assignSingleton(table: SingletonPresetTable, presetId: string | null) {
    if (!presetId) {
      db.prepare(`DELETE FROM ${table} WHERE id = 1`).run();
      return null;
    }
    if (!accessors.getPresetById(presetId)) {
      return { ok: false as const, error: deps.errors.presetNotFound };
    }
    db.prepare(`
      INSERT OR REPLACE INTO ${table} (id, preset_id, assigned_at)
      VALUES (1, ?, ?)
    `).run(presetId, now());
    return null;
  }
  function readSingleton(table: SingletonPresetTable) {
    const id = accessors.getSingletonPresetId(table);
    const row = id ? accessors.getPresetById(id) : null;
    return { preset: row ? singletonView(row) : null };
  }
  return {
    designate,
    getReviewPreset: async () => readSingleton("review_preset"),
    assignReviewPreset: async ({ presetId }: SingletonInput) =>
      designate("review_preset", presetId),
    getGenerationPreset: async () => readSingleton("generation_preset"),
    assignGenerationPreset: async ({ presetId }: SingletonInput) =>
      designate("generation_preset", presetId),
    getReliablePreset: async () => readSingleton("reliable_preset"),
    assignReliablePreset: async ({ presetId }: SingletonInput) =>
      designate("reliable_preset", presetId),
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

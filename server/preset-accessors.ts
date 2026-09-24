import { resolveEffectiveEnvKind } from "../lib/github-automation-gate.mjs";
import { resolveReliablePreset } from "../lib/reliable-preset.mjs";
import { bandForCardKindStage, liveWorkerCards } from "../lib/preset-staleness.mjs";
import { bandForKind } from "../lib/tracks.mjs";
import { assignedPreset, refreshRestartPending } from "../lib/worker-ledger.mjs";
import type {
  CardPresetOverride,
  PresetAttachmentParams,
  PresetDb,
  PresetRow,
  SingletonPresetTable,
} from "./preset-contracts.js";

export function createPresetAccessors(db: PresetDb, now: () => number) {
  const getPresetById = (id: string): PresetRow | null =>
    (db.prepare("SELECT * FROM presets WHERE id = ?").get(id) as PresetRow | undefined) ?? null;

  const getDefaultPreset = (): PresetRow => {
    const preferred = firstPreset(db, "WHERE is_default = 1");
    const fallback = firstPreset(db, "");
    if (preferred || fallback) return (preferred ?? fallback)!;
    insertFallbackDefault(db, now);
    return getPresetById("preset_default")!;
  };

  const getPresetForCard = (cardId: string): PresetRow =>
    getPresetById(assignmentFor(db, cardId) ?? "") ?? getDefaultPreset();

  const getPresetForBand = (band: string, cardId: string): PresetRow => {
    const pinned = getPresetById(assignmentFor(db, cardId) ?? "");
    if (pinned) return pinned;
    return getPresetById(bandPresetId(db, band) ?? "") ?? getPresetForCard(cardId);
  };

  const getReliablePresetForBand = (band: string, cardId: string): PresetRow => {
    const resolved = resolveReliablePreset({
      cardPin: assignmentFor(db, cardId),
      reliableOverride: singletonPresetId(db, "reliable_preset"),
      bandPreset: bandPresetId(db, band),
      defaultPreset: null,
    });
    return getPresetById(resolved.presetId ?? "") ?? getPresetForCard(cardId);
  };

  const presetAttachmentParams = (preset: PresetRow): PresetAttachmentParams => ({
    providerId: preset.provider_id,
    modelId: preset.model_id,
    reasoningLevel: preset.reasoning_level,
    permissionMode: preset.permission_mode,
    environmentKind: preset.environment_kind,
    baseBranch: preset.base_branch,
    machineId: preset.machine_id,
    instructions: preset.instructions,
  });

  const createCardOverride = (
    cardId: string,
    base: PresetRow,
    override: CardPresetOverride,
  ): PresetRow => {
    insertCardOverride(db, now, cardId, base, override);
    return getPresetById(`card-override-${cardId}`)!;
  };

  const pinCardPreset = (
    cardId: string,
    presetId: string,
    assignedAt = now(),
  ): boolean => {
    if (!getPresetById(presetId)) return false;
    db.prepare(`
      INSERT OR REPLACE INTO card_presets (card_id, preset_id, assigned_at)
      VALUES (?, ?, ?)
    `).run(cardId, presetId, assignedAt);
    return true;
  };

  const removeCardPreset = (cardId: string): void => {
    db.prepare("DELETE FROM card_presets WHERE card_id = ?").run(cardId);
    db.prepare("DELETE FROM presets WHERE id = ?").run(`card-override-${cardId}`);
  };

  const refreshLiveWorkers = (bands: string[] | null): void => {
    for (const card of liveWorkerCards(db, bands)) {
      const band = bandForCardKindStage(card.kind, card.stage);
      const effective = getReliablePresetForBand(band, card.id);
      refreshRestartPending(
        db,
        card.id,
        card.worker_thread_id,
        card.worker_preset_id,
        effective.id,
      );
    }
  };

  return {
    getDefaultPreset,
    getPresetById,
    getPresetForCard,
    getPresetForBand,
    getReliablePresetForBand,
    presetAttachmentParams,
    createCardOverride,
    pinCardPreset,
    removeCardPreset,
    refreshLiveWorkers,
    refreshCardWorker: (cardId: string, presetId: string) => {
      const card = liveWorkerCards(db, null).find((entry) => entry.id === cardId);
      if (!card) return;
      refreshRestartPending(
        db,
        card.id,
        card.worker_thread_id,
        card.worker_preset_id,
        presetId,
      );
    },
    getBandPresetId: (band: string) => bandPresetId(db, band),
    getGenerationPresetId: () => singletonPresetId(db, "generation_preset"),
    getReviewPresetId: () => singletonPresetId(db, "review_preset"),
    getReliablePresetId: () => singletonPresetId(db, "reliable_preset"),
    getSingletonPresetId: (table: SingletonPresetTable) => singletonPresetId(db, table),
    getWorktreePresetId: () => firstWorktreePreset(db),
    getEffectiveBuildEnvironmentKind: () => effectiveBuildEnvironmentKind(db),
    hasCardPreset: (cardId: string) => assignmentFor(db, cardId) !== null,
  };
}

export type PresetAccessors = ReturnType<typeof createPresetAccessors>;

function insertCardOverride(
  db: PresetDb,
  now: () => number,
  cardId: string,
  base: PresetRow,
  override: CardPresetOverride,
): void {
  if (!override.providerId || !override.modelId || !override.reasoningLevel || !override.permissionMode) {
    throw new Error("Card preset override is incomplete.");
  }
  const id = `card-override-${cardId}`;
  const timestamp = now();
  db.prepare(`
    INSERT OR REPLACE INTO presets (
      id, name, provider_id, model_id, reasoning_level, permission_mode,
      environment_kind, base_branch, machine_id, instructions, is_default,
      built_in, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?)
  `).run(
    id,
    `Card override ${cardId}`,
    override.providerId,
    override.modelId,
    override.reasoningLevel,
    override.permissionMode,
    base.environment_kind,
    base.base_branch,
    base.machine_id,
    base.instructions,
    timestamp,
    timestamp,
  );
}

function firstPreset(db: PresetDb, where: string): PresetRow | null {
  const row = db.prepare(
    `SELECT * FROM presets ${where} ORDER BY created_at ASC LIMIT 1`,
  ).get() as PresetRow | undefined;
  return row ?? null;
}

function insertFallbackDefault(db: PresetDb, now: () => number): void {
  db.prepare(`INSERT INTO presets (
    id, name, provider_id, model_id, reasoning_level, permission_mode,
    environment_kind, instructions, is_default, built_in, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    "preset_default", "Default", "pi", "bifrost/harness-coding", "medium",
    "full", "project-default", "", 1, 1, now(), now(),
  );
}

function assignmentFor(db: PresetDb, cardId: string): string | null {
  return assignedPreset(db, cardId)?.preset_id ?? null;
}

function bandPresetId(db: PresetDb, band: string): string | null {
  return presetIdFor(db, "stage_presets", "band", band);
}

function singletonPresetId(
  db: PresetDb,
  table: SingletonPresetTable,
): string | null {
  return presetIdFor(db, table, "id", 1);
}

function presetIdFor(
  db: PresetDb,
  table: "stage_presets" | SingletonPresetTable,
  key: "band" | "id",
  value: string | number,
): string | null {
  const row = db.prepare(`SELECT preset_id FROM ${table} WHERE ${key} = ?`)
    .get(value) as { preset_id: string } | undefined;
  return row?.preset_id ?? null;
}

function firstWorktreePreset(db: PresetDb): string | null {
  const row = db.prepare(`
    SELECT id FROM presets WHERE environment_kind = 'new-worktree'
    ORDER BY is_default DESC, name ASC LIMIT 1
  `).get() as { id: string } | undefined;
  return row?.id ?? null;
}

function effectiveBuildEnvironmentKind(db: PresetDb): string {
  const bandId = bandPresetId(db, bandForKind("build"));
  const bandRow = bandId
    ? db.prepare("SELECT environment_kind FROM presets WHERE id = ?").get(bandId) as
        { environment_kind: string } | undefined
    : undefined;
  return resolveEffectiveEnvKind({
    bandEnvKind: bandRow?.environment_kind,
    worktreePresetId: firstWorktreePreset(db),
  });
}

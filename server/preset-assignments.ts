import type {
  CardPresetOverride,
  PresetDb,
  PresetRow,
} from "./preset-contracts.js";
import type { createPresetLookupAccessors } from "./preset-lookups.js";

type PresetLookups = ReturnType<typeof createPresetLookupAccessors>;

export function createPresetAssignmentAccessors(
  db: PresetDb,
  now: () => number,
  lookups: PresetLookups,
) {
  function createCardOverride(
    cardId: string,
    base: PresetRow,
    override: CardPresetOverride,
  ): PresetRow {
    insertCardOverride(db, now, cardId, base, override);
    return lookups.getPresetById(`card-override-${cardId}`)!;
  }

  function pinCardPreset(
    cardId: string,
    presetId: string,
    assignedAt = now(),
  ): boolean {
    if (!lookups.getPresetById(presetId)) return false;
    db.prepare(`
      INSERT OR REPLACE INTO card_presets (card_id, preset_id, assigned_at)
      VALUES (?, ?, ?)
    `).run(cardId, presetId, assignedAt);
    return true;
  }

  function removeCardPreset(cardId: string): void {
    db.prepare("DELETE FROM card_presets WHERE card_id = ?").run(cardId);
    db.prepare("DELETE FROM presets WHERE id = ?").run(`card-override-${cardId}`);
  }

  return { createCardOverride, pinCardPreset, removeCardPreset };
}

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

import {
  declaredProviderLevels,
  isLevelDeclaredForProvider,
  isPresetReasoningLevel,
  ladderIncludes,
  PRESET_REASONING_LEVELS,
  unsupportedLevelMessage,
} from "../lib/preset-reasoning-level.mjs";
import type { PresetAccessors } from "./preset-accessors.js";
import type {
  PresetRow,
  PresetServerDeps,
  PresetUpsertInput,
} from "./preset-contracts.js";

/**
 * The provider roster the host declares, or `null` when the host cannot be
 * asked. `ProviderInfo.reasoningLevels` is a declaration, not a probe: it is
 * answered from the loaded provider plugins, so it costs one in-process call
 * and works with every bridge down. The per-MODEL ladder
 * (`providers.models().models[].supportedReasoningEfforts`) is the precise
 * answer, but it is a live `model/list` per provider — too slow to put on the
 * write path of a settings form, and it fails when a provider is not installed,
 * which must not make a preset unsavable.
 */
type ProviderRoster = Parameters<typeof isLevelDeclaredForProvider>[0];

async function readProviderRoster(deps: PresetServerDeps): Promise<ProviderRoster> {
  // Read inside the try, not just the `.catch`: the SDK's own contract is that
  // touching `sdk` before the host binds it throws, so a `.catch` on the call
  // would not see a throw from reaching the call. An unavailable roster is a
  // normal state here, not an error — it degrades every level check to
  // "unverified" and the list to `null`.
  try {
    const providers = await deps.bb.sdk.providers.list();
    return providers.map((provider) => ({
      id: provider.id,
      reasoningLevels: provider.reasoningLevels,
    }));
  } catch {
    return null;
  }
}

export function createPresetCrudHandlers(
  deps: PresetServerDeps,
  accessors: PresetAccessors,
) {
  const { db, now } = deps;
  const listPresets = createPresetListHandler(deps);

  async function upsertPreset(input: PresetUpsertInput) {
    const trimmed = input.name.trim();
    if (!trimmed) throw new Error("Preset name is required.");
    assertSpawnableReasoningLevel(input.reasoningLevel);
    await assertProviderHonoursReasoningLevel(deps, input.providerId, input.reasoningLevel);
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

/**
 * One check for every writer that reaches this handler — the settings form, the
 * CLI, and any RPC caller. Refused rather than repaired: silently rewriting the
 * level would spawn the card at an effort nobody chose, while the settings
 * screen kept showing the choice they made.
 */
function assertSpawnableReasoningLevel(value: string): void {
  if (isPresetReasoningLevel(value)) return;
  throw new Error(
    `Preset reasoning level "${value}" is not one of: ${PRESET_REASONING_LEVELS.join(", ")}.`,
  );
}

/**
 * The second half of the level check, and the one the enum cannot do: a level
 * can be perfectly valid for the host and still be one this provider never
 * declared, in which case the worker spawns at the provider's default while the
 * settings screen keeps showing the level that was chosen.
 *
 * Refused only on POSITIVE knowledge — a roster read that succeeded and a
 * provider that declared a ladder without this level in it. An unreadable
 * roster, an unknown provider, and a provider that declares no ladder all pass,
 * because refusing there would make the settings form unusable whenever the
 * host hiccups, and a card that runs at the provider default is recoverable
 * while a preset that cannot be saved is not. Those passes are not a claim of
 * support: `describePresetLevelSupport` reports them as unverified so the
 * reader is told the difference.
 */
async function assertProviderHonoursReasoningLevel(
  deps: PresetServerDeps,
  providerId: string,
  level: string,
): Promise<void> {
  const declared = declaredProviderLevels(await readProviderRoster(deps), providerId);
  if (!declared) return;
  if (ladderIncludes(declared, level)) return;
  throw new Error(unsupportedLevelMessage(providerId, level, declared));
}

/**
 * Every stored preset, each carrying whether the host's roster says its
 * provider honours its level: `true`/`false` on a declared ladder, `null` when
 * the roster is unreadable or the provider declares none.
 *
 * The list is the surface that renders a level as a plain fact next to a
 * provider and a model, so it is the one place where "the write boundary would
 * have refused this" has to be visible to a reader. The roster is read once per
 * call and shared across rows — it is one in-process read of the loaded provider
 * plugins, not a per-preset probe, and a read failure degrades every row to
 * `null` rather than failing the list the panels load on startup.
 */
function createPresetListHandler(deps: PresetServerDeps) {
  return async () => {
    const rows = deps.db.prepare(`
      SELECT * FROM presets WHERE id NOT LIKE 'card-override-%'
      ORDER BY is_default DESC, name COLLATE NOCASE ASC
    `).all() as PresetRow[];
    const roster = await readProviderRoster(deps);
    return { presets: rows.map((row) => publicPreset(row, roster)) };
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

function publicPreset(row: PresetRow, roster: ProviderRoster | null) {
  return {
    id: row.id,
    name: row.name,
    providerId: row.provider_id,
    modelId: row.model_id,
    reasoningLevel: row.reasoning_level,
    // Null is the honest "the host did not say", kept distinct from false so a
    // client cannot render an unverified level as a supported one.
    reasoningLevelSupported: isLevelDeclaredForProvider(roster, row.provider_id, row.reasoning_level),
    permissionMode: row.permission_mode,
    environmentKind: row.environment_kind,
    baseBranch: row.base_branch,
    machineId: row.machine_id,
    instructions: row.instructions,
    isDefault: row.is_default === 1,
    builtIn: row.built_in === 1,
  };
}

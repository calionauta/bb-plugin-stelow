/**
 * Composer execution passthrough: the single source of truth for "what the
 * user picked in the NewThreadComposer when opening a card".
 *
 * The BB composer owns the provider/model/reasoning/permission pickers. Its
 * `default*` props are seeds only — the user can change every one of them —
 * and the submitted `NewThreadRequest` carries the final choice plus
 * per-field provenance (`executionInputSources`). The Stelow create-card
 * dialogs used to drop that choice and spawn the worker on the band/default
 * preset instead, so a card opened with e.g. acp-opencode/muse-spark still
 * ran on pi/bifrost/harness-coding.
 *
 * The fix keeps presets as the canonical worker record (so card detail,
 * retry/restart/band-swap and reseed keep working through the existing
 * override-aware preset resolution): when the composer's choice differs from
 * the resolved base preset, creation pins a `card-override-<cardId>` preset
 * row holding the composer's values. All comparison/merge rules live here —
 * pure functions with a node test — never inline in server.ts handlers.
 *
 * serviceTier is spawn-only: the presets table has no column for it, so it
 * rides to `threads.spawn` on creation but is not persisted for restarts
 * (same limitation presets already had — never worse).
 */

export const COMPOSER_PERMISSION_MODES = ["accept-edits", "auto", "full"];

export const COMPOSER_SERVICE_TIERS = ["default", "fast"];

const SOURCE_VALUES = ["explicit", "client-preference"];

/** Preset-owned execution fields: the only ones a card-override row can hold. */
const OVERRIDE_FIELDS = ["providerId", "modelId", "reasoningLevel", "permissionMode"];

function cleanString(value, max) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) return null;
  return trimmed;
}

function baseField(base, camel, snake) {
  if (!base || typeof base !== "object") return null;
  const value = base[camel] ?? base[snake];
  return typeof value === "string" ? value : null;
}

/**
 * Sanitize a raw composer `execution` payload into the clean shape the
 * resolver understands, or null when it carries nothing usable. Unknown
 * fields are dropped; empty strings count as absent so a partial choice
 * merges per-field instead of clobbering the base preset with "".
 */
export function sanitizeComposerExecution(execution) {
  if (!execution || typeof execution !== "object") return null;
  const clean = {};
  const providerId = cleanString(execution.providerId, 60);
  if (providerId) clean.providerId = providerId;
  const model = cleanString(execution.model, 120);
  if (model) clean.model = model;
  const reasoningLevel = cleanString(execution.reasoningLevel, 20);
  if (reasoningLevel) clean.reasoningLevel = reasoningLevel;
  if (typeof execution.permissionMode === "string" && COMPOSER_PERMISSION_MODES.includes(execution.permissionMode)) {
    clean.permissionMode = execution.permissionMode;
  }
  if (typeof execution.serviceTier === "string" && COMPOSER_SERVICE_TIERS.includes(execution.serviceTier)) {
    clean.serviceTier = execution.serviceTier;
  }
  const sources = execution.executionInputSources;
  if (sources && typeof sources === "object") {
    const cleanSources = {};
    for (const key of ["providerId", "model", "reasoningLevel", "permissionMode", "serviceTier"]) {
      if (typeof sources[key] === "string" && SOURCE_VALUES.includes(sources[key])) cleanSources[key] = sources[key];
    }
    if (Object.keys(cleanSources).length > 0) clean.executionInputSources = cleanSources;
  }
  return Object.keys(clean).length > 0 ? clean : null;
}

/**
 * The composer's per-field values merged over a base preset: composer wins
 * per-field, the base fills the gaps. Accepts the base as either a preset
 * row (snake_case) or spawn params (camelCase) so initial spawn and any
 * future caller share this one merge.
 */
export function resolveComposerSpawn(base, execution) {
  const clean = sanitizeComposerExecution(execution);
  const merged = {
    providerId: baseField(base, "providerId", "provider_id"),
    modelId: baseField(base, "modelId", "model_id"),
    reasoningLevel: baseField(base, "reasoningLevel", "reasoning_level"),
    permissionMode: baseField(base, "permissionMode", "permission_mode"),
  };
  if (!clean) return merged;
  if (clean.providerId) merged.providerId = clean.providerId;
  if (clean.model) merged.modelId = clean.model;
  if (clean.reasoningLevel) merged.reasoningLevel = clean.reasoningLevel;
  if (clean.permissionMode) merged.permissionMode = clean.permissionMode;
  return merged;
}

/**
 * Null when the composer's choice already matches the base preset (no
 * override row needed — keeps `listPresets` clean and the card on the
 * shared preset); otherwise the merged `{providerId, modelId,
 * reasoningLevel, permissionMode}` values to persist in the
 * `card-override-<cardId>` row.
 */
export function composerPresetOverride(base, execution) {
  const clean = sanitizeComposerExecution(execution);
  if (!clean) return null;
  const merged = resolveComposerSpawn(base, clean);
  const current = {
    providerId: baseField(base, "providerId", "provider_id"),
    modelId: baseField(base, "modelId", "model_id"),
    reasoningLevel: baseField(base, "reasoningLevel", "reasoning_level"),
    permissionMode: baseField(base, "permissionMode", "permission_mode"),
  };
  const differs = OVERRIDE_FIELDS.some((field) => {
    const key = field === "modelId" ? "model" : field;
    return clean[key] != null && merged[field] !== current[field];
  });
  return differs ? { providerId: merged.providerId, modelId: merged.modelId, reasoningLevel: merged.reasoningLevel, permissionMode: merged.permissionMode } : null;
}

/**
 * Full execution block for `threads.spawn`: the composer's values merged
 * over the base params, the composer's serviceTier when valid, and the
 * composer's provenance where given (the server drops a requested
 * providerId/model without provenance and re-derives it from project
 * defaults — forwarding the composer's sources is what makes the choice
 * survive the spawn). Missing provenance defaults to explicit: a Stelow
 * spawn is always a deliberate choice, never an inference.
 */
export function composerSpawnInput(baseParams, execution) {
  const clean = sanitizeComposerExecution(execution);
  const merged = resolveComposerSpawn(baseParams ?? {}, clean ?? undefined);
  const sources = (clean && clean.executionInputSources) || {};
  const input = {
    providerId: merged.providerId,
    model: merged.modelId,
    reasoningLevel: merged.reasoningLevel,
    permissionMode: merged.permissionMode,
    executionInputSources: {
      providerId: sources.providerId ?? "explicit",
      model: sources.model ?? "explicit",
      reasoningLevel: sources.reasoningLevel ?? "explicit",
      permissionMode: sources.permissionMode ?? "explicit",
    },
  };
  if (clean && clean.serviceTier) {
    input.serviceTier = clean.serviceTier;
    input.executionInputSources.serviceTier = sources.serviceTier ?? "explicit";
  }
  return input;
}

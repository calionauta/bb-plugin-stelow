/**
 * Preset-staleness fan-out. Provider/model are fixed at spawn, so any preset
 * change (card pin, band, reliable override, preset delete) must re-evaluate
 * the restart-pending flag of every live worker running under it. Pure DB
 * helpers (no BB host dependency) so the filtering is exercised against
 * real SQLite in tests; the caller recomputes each card's effective preset
 * and feeds it to refreshRestartPending (lib/worker-ledger.mjs).
 */
import { STAGE_BY_ID, STAGE_TO_BAND } from "./workflow-vocabulary.mjs";

export function isWorkerPresetStale(card, detail) {
  return Boolean(
    detail &&
    card.workerThreadId &&
    (detail.card.presetRestartPending ||
      (detail.card.workerPresetId && detail.card.workerPresetId !== detail.card.presetId)),
  );
}

// Which band a card's worker resolves through: research/explore own theirs,
// build cards ride their stage's band, unknown stages fall back to analysis.
export function bandForCardKindStage(kind, stage) {
  if (kind === "research") return "research";
  if (kind === "explore") return "explore";
  return STAGE_TO_BAND[stage] ?? "analysis";
}

/**
 * The upstream model-hint scale, in the order a routing decision reads it.
 * Mirrors `data/stelow-stage-catalog.json#stages[].model_hint`, which mirrors
 * upstream `stages.yaml`. The catalog is the source; this list only fixes the
 * legal set so a free-text hint (`stages.schema.json` types it as a plain
 * string) can never invent a band.
 */
export const PRESET_TIERS = ["economy", "standard", "best"];

/**
 * A stage's declared tier as a band name, or null when it declares none.
 *
 * Unvalidated hints resolve to null rather than to a throw: an upstream typo
 * must degrade to the phase band, which is today's behavior, and never take a
 * spawn down. This is the fail-open edge that makes routing an improvement
 * instead of a new refusal path.
 */
export function tierBandForStage(stage) {
  const hint = STAGE_BY_ID[stage]?.model_hint;
  return typeof hint === "string" && PRESET_TIERS.includes(hint) ? hint : null;
}

/**
 * The bands a card's worker resolves through, most specific first.
 *
 * The tier band is a SEPARATE key in `stage_presets`, not a replacement for
 * the phase band. That is what keeps the change additive: an install with no
 * tier rows pinned routes exactly as it did before, and the phase band stays
 * the answer for every stage whose upstream hint is missing or unrecognised.
 *
 * Research and explore own their bands and are already single-tier by
 * construction, so they list one entry and never consult a hint.
 */
export function presetBandsForCardKindStage(kind, stage) {
  const phaseBand = bandForCardKindStage(kind, stage);
  if (kind === "research" || kind === "explore") return [phaseBand];
  const tier = tierBandForStage(stage);
  return tier ? [tier, phaseBand] : [phaseBand];
}

// Every card that could run stale: a live worker on a non-archived card.
// Pass null for all bands, or a band list to narrow (e.g. after a band
// preset change only that band's workers can be affected). Workerless and
// archived cards are never touched — their flags belong to spawn paths.
//
// A card matches when any band in its chain is in the narrowed set, because
// the chain holds both keys the card resolves through (its stage's tier band
// and its phase band) and a change to either must reach it.
export function liveWorkerCards(db, bands) {
  const rows = db.prepare("SELECT id, kind, stage, worker_thread_id, worker_preset_id FROM cards WHERE worker_thread_id IS NOT NULL AND status != 'archived'").all();
  if (!Array.isArray(bands)) return rows;
  const wanted = new Set(bands);
  return rows.filter((row) => presetBandsForCardKindStage(row.kind, row.stage).some((band) => wanted.has(band)));
}

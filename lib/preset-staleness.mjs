/**
 * Preset-staleness fan-out. Provider/model are fixed at spawn, so any preset
 * change (card pin, band, reliable override, preset delete) must re-evaluate
 * the restart-pending flag of every live worker running under it. Pure DB
 * helpers (no BB host dependency) so the filtering is exercised against
 * real SQLite in tests; the caller recomputes each card's effective preset
 * and feeds it to refreshRestartPending (lib/worker-ledger.mjs).
 */
import { STAGE_TO_BAND } from "./workflow-vocabulary.mjs";

// Which band a card's worker resolves through: research/explore own theirs,
// build cards ride their stage's band, unknown stages fall back to analysis.
export function bandForCardKindStage(kind, stage) {
  if (kind === "research") return "research";
  if (kind === "explore") return "explore";
  return STAGE_TO_BAND[stage] ?? "analysis";
}

// Every card that could run stale: a live worker on a non-archived card.
// Pass null for all bands, or a band list to narrow (e.g. after a band
// preset change only that band's workers can be affected). Workerless and
// archived cards are never touched — their flags belong to spawn paths.
export function liveWorkerCards(db, bands) {
  const rows = db.prepare("SELECT id, kind, stage, worker_thread_id, worker_preset_id FROM cards WHERE worker_thread_id IS NOT NULL AND status != 'archived'").all();
  if (!Array.isArray(bands)) return rows;
  const wanted = new Set(bands);
  return rows.filter((row) => wanted.has(bandForCardKindStage(row.kind, row.stage)));
}

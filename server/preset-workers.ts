import { bandForCardKindStage, liveWorkerCards } from "../lib/preset-staleness.mjs";
import { refreshRestartPending } from "../lib/worker-ledger.mjs";
import type { PresetDb } from "./preset-contracts.js";
import type { createPresetSelectionAccessors } from "./preset-lookups.js";

type PresetSelections = ReturnType<typeof createPresetSelectionAccessors>;

export function createPresetWorkerAccessors(
  db: PresetDb,
  selections: PresetSelections,
) {
  function refreshLiveWorkers(bands: string[] | null): void {
    for (const card of liveWorkerCards(db, bands)) {
      const band = bandForCardKindStage(card.kind, card.stage);
      const effective = selections.getReliablePresetForBand(band, card.id);
      refreshRestartPending(
        db,
        card.id,
        card.worker_thread_id,
        card.worker_preset_id,
        effective.id,
      );
    }
  }

  function refreshCardWorker(cardId: string, presetId: string): void {
    const card = liveWorkerCards(db, null).find((entry) => entry.id === cardId);
    if (!card) return;
    refreshRestartPending(
      db,
      card.id,
      card.worker_thread_id,
      card.worker_preset_id,
      presetId,
    );
  }

  return { refreshLiveWorkers, refreshCardWorker };
}

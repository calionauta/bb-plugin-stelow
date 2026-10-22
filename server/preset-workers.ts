import { presetBandsForCardKindStage, liveWorkerCards } from "../lib/preset-staleness.mjs";
import { refreshRestartPending } from "../lib/worker-ledger.mjs";
import type { PresetDb } from "./preset-contracts.js";
import type { createPresetSelectionAccessors } from "./preset-lookups.js";

type PresetSelections = ReturnType<typeof createPresetSelectionAccessors>;

export function createPresetWorkerAccessors(
  db: PresetDb,
  selections: PresetSelections,
) {
  function refreshLiveWorkers(bands: string[] | null): void {
    // `bands` narrows the fan-out to the tier bands the caller just changed.
    // A card matches when ANY band in its chain is in that set — the tier band
    // or the phase band — because both are keys into the same table and either
    // one moving can change the card's effective preset.
    for (const card of liveWorkerCards(db, bands)) {
      const chain = presetBandsForCardKindStage(card.kind, card.stage);
      const effective = selections.getReliablePresetForBand(chain, card.id);
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

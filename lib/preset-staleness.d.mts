export declare function bandForCardKindStage(kind: string, stage: string): string;

/** The upstream model-hint scale: economy, standard, best (in routing order). */
export declare const PRESET_TIERS: readonly string[];

/** A stage's declared tier as a band name, or null when it declares none. */
export declare function tierBandForStage(stage: string): string | null;

/**
 * The bands a card's worker resolves through, most specific first: the stage's
 * tier band when it declares a valid hint, then its phase band. Research and
 * explore own their bands and always yield one entry.
 */
export declare function presetBandsForCardKindStage(kind: string, stage: string): string[];

type WorkerPresetCard = { workerThreadId?: string | null };
type WorkerPresetDetail = {
  card: {
    presetRestartPending?: boolean | null;
    workerPresetId?: string | null;
    presetId?: string | null;
  } | null;
} | null;
export declare function isWorkerPresetStale(
  card: WorkerPresetCard,
  detail: WorkerPresetDetail,
): boolean;

export interface LiveWorkerCard {
  id: string;
  kind: string;
  stage: string;
  worker_thread_id: string;
  worker_preset_id: string | null;
}

export declare function liveWorkerCards(db: unknown, bands: string[] | null): LiveWorkerCard[];

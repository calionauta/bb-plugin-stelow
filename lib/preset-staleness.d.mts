export declare function bandForCardKindStage(kind: string, stage: string): string;

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

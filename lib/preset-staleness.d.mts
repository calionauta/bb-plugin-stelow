export declare function bandForCardKindStage(kind: string, stage: string): string;

export interface LiveWorkerCard {
  id: string;
  kind: string;
  stage: string;
  worker_thread_id: string;
  worker_preset_id: string | null;
}

export declare function liveWorkerCards(db: unknown, bands: string[] | null): LiveWorkerCard[];

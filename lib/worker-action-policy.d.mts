export declare type WorkerActionCard = {
  status?: string | null;
  activity?: string | null;
} | null | undefined;

export declare function isArchivedCard(card: WorkerActionCard): boolean;

export declare function workerActionPolicy(card: WorkerActionCard, needsAttention?: boolean): {
  archived: boolean;
  showPresetControls: boolean;
  showRestartFresh: boolean;
  showStopAndArchive: boolean;
  showDelete: boolean;
};

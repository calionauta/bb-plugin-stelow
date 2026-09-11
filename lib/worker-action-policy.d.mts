export declare type WorkerActionCard = {
  status?: string | null;
  activity?: string | null;
} | null | undefined;

export declare function isArchivedCard(card: WorkerActionCard): boolean;

export declare function stripArchivedResuscitation(
  previousStatus: string | null | undefined,
  fields: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null | undefined;

export declare function workerActionPolicy(card: WorkerActionCard, needsAttention?: boolean): {
  archived: boolean;
  hasActiveWorker: boolean;
  showPresetControls: boolean;
  showRestartFresh: boolean;
  showArchive: boolean;
  showDelete: boolean;
};

export declare function workerSectionPolicy(card: WorkerActionCard, needsAttention?: boolean, content?: {
  hasGithubLink?: boolean;
  historyCount?: number;
}): ReturnType<typeof workerActionPolicy> & {
  showSection: boolean;
};

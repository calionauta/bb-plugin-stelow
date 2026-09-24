export type BuildCard = {
  projectId: string;
  intent: string;
  status: string;
  stage: string;
  activity: string;
  needsAttention: boolean;
  updatedAt: number;
  workerThreadId?: string | null;
};

export type BuildFilters = {
  columns: readonly string[];
  projectIds: string[];
  intents: string[];
  statuses: string[];
  activities: string[];
  stages: string[];
  attention: boolean;
};

export function filterAndGroupBuildCards<T extends BuildCard>(
  cards: T[],
  filters: BuildFilters,
): Record<string, T[]>;

export function buildCardMatches(card: BuildCard, filters: BuildFilters): boolean;

export function reviewGatesAfterDefaults<T>(
  current: T,
  defaults: T,
  hasStoredSelection: boolean,
): T;

export type ExploreCard = {
  projectId: string;
  status: string;
  needsAttention: boolean;
  updatedAt: number;
};

export type ExploreFilters = {
  columns: readonly string[];
  projectIds: string[];
  attention: boolean;
};

export function exploreCardListRequest(
  projectId: string | null,
): { projectId: string | null; kind: "explore" };

export function exploreCardMatches(
  card: ExploreCard,
  filters: ExploreFilters,
): boolean;

export function filterAndGroupExploreCards<T extends ExploreCard>(
  cards: T[],
  filters: ExploreFilters,
): Record<string, T[]>;

export function techniqueLabelsById<T extends { id: string; label: string }>(
  stages: T[],
): Map<string, string>;

export function explorePresetFor<T, B extends { band: string; presetId: string | null }>(
  presets: T[],
  assignments: B[],
): { preset: T | null; hasBandPreset: boolean };

export function moveExploreCard(
  moveCard: (
    cardId: string,
    status: "inbox" | "doing" | "done" | "archived",
  ) => Promise<{ ok: boolean; error?: string | null }>,
  cardId: string,
  target: string,
  onError: (message: string) => void,
): Promise<void>;

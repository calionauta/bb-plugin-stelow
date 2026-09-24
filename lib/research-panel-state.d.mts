export type ResearchCard = {
  projectId: string;
  status: string;
  needsAttention: boolean;
  updatedAt: number;
};

export type ResearchFilters = {
  columns: readonly string[];
  projectIds: string[];
  attention: boolean;
};

export function researchCardListRequest(
  projectId: string | null,
): { projectId: string | null; kind: "research" };

export function researchCardMatches(
  card: ResearchCard,
  filters: ResearchFilters,
): boolean;

export function filterAndGroupResearchCards<T extends ResearchCard>(
  cards: T[],
  filters: ResearchFilters,
): Record<string, T[]>;

export function strategyLabelsById<T extends { id: string; label: string }>(
  strategies: T[],
): Map<string, string>;

export function researchPresetFor<T, B extends { band: string; presetId: string | null }>(
  presets: T[],
  assignments: B[],
): { preset: T | null; hasBandPreset: boolean };

export function moveResearchCard(
  moveCard: (
    cardId: string,
    status: "inbox" | "doing" | "done" | "archived",
  ) => Promise<{ ok: boolean; error?: string | null }>,
  cardId: string,
  target: string,
  onError: (message: string) => void,
): Promise<void>;

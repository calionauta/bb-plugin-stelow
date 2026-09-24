export interface ListScopeSummary {
  scopesDone: number;
  scopesTotal: number;
  tasksDone: number;
  tasksTotal: number;
}

export interface BuildListCard {
  status: string;
  stage: string;
  scopeSummary: ListScopeSummary;
}

export interface ResearchListCard {
  researchStrategies?: string[] | null;
}

export interface ExploreListCard {
  exploreStage?: string | null;
}

export interface ReviewState {
  status: string;
  hasPendingReview: boolean;
}

export interface ListRowCard extends BuildListCard, ReviewState {
  kind: "build" | "research" | "explore";
}

export function pendingReview(card: ReviewState): boolean;
export function showScopeStrip(card: ListRowCard): boolean;
export function buildListMeta(card: BuildListCard): string;
export function researchListMeta(
  card: ResearchListCard,
  labels: ReadonlyMap<string, string>,
): string | null;
export function exploreListMeta(
  card: ExploreListCard,
  labels: ReadonlyMap<string, string>,
): string | null;

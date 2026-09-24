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

export function buildListMeta(card: BuildListCard): string;
export function researchListMeta(
  card: ResearchListCard,
  labels: ReadonlyMap<string, string>,
): string | null;
export function exploreListMeta(
  card: ExploreListCard,
  labels: ReadonlyMap<string, string>,
): string | null;

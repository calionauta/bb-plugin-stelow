export interface ExploreStage {
  id: string;
  label: string;
  skill: string;
  emoji: string;
  blurb: string;
  keywords: string[];
}

export declare const STAGE_CATALOG: ExploreStage[];
export declare function stageById(id: string): ExploreStage | null;
export interface ExploreTechnique {
  id: string;
  label: string;
  skill: string;
  emoji: string;
  blurb: string;
  keywords: string[];
}

export declare const TECHNIQUE_CATALOG: ExploreTechnique[];
export declare function techniqueById(id: string): ExploreTechnique | null;
/** @deprecated Use ExploreTechnique / TECHNIQUE_CATALOG. */
export type ExploreStage = ExploreTechnique;
/** @deprecated Use TECHNIQUE_CATALOG. */
export declare const STAGE_CATALOG: ExploreTechnique[];
/** @deprecated Use techniqueById. */
export declare function stageById(id: string): ExploreTechnique | null;

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

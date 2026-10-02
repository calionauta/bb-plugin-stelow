export type StageAttribution = {
  /** Upstream skill dir that owns the stage. */
  skill: string;
  /** Most precise stable link to that stage's definition. */
  url: string | null;
};

export type StageSummary = {
  /** "What this stage produces", or null when the catalog is silent. */
  produces: string | null;
  /** Who defines it, or null for a stage with no owning skill. */
  attribution: StageAttribution | null;
  /** `produces` and attribution pre-joined, for a surface with no link. */
  text: string;
};

/** Sentence explaining what a stage produces, or null when unknown. */
export declare function stageProduces(stage: string): string | null;

/** The stage's owning skill and its link as a pair; null when it has none. */
export declare function stageAttribution(stage: string): StageAttribution | null;

/** Everything one surface needs to answer "what is this stage"; null if unknown. */
export declare function stageSummary(stage: string): StageSummary | null;

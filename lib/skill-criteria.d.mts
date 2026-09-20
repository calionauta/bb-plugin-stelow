export declare const SKILL_CRITERION_KINDS: string[];

export interface SkillCriterion {
  id: string;
  kind: "presence" | "count" | "semantic";
  text: string;
}

export declare function parseCriteriaBlock(markdown: unknown): SkillCriterion[];

export declare function groupCriteriaByKind(items: unknown): {
  presence: SkillCriterion[];
  count: SkillCriterion[];
  semantic: SkillCriterion[];
};

export declare function semanticCriterionToScore(criterion: unknown): Record<string, unknown>;

export declare const CRITERIA_MET_SCORE: number;
export declare const CRITERIA_UNMET_SCORE: number;

export interface CriterionFinding {
  id: string;
  kind: string;
  text: string;
  score: number | null;
  confidence: number | null;
  verdict: "met" | "unmet" | "unverifiable";
  error: string | null;
}

export interface CriteriaJudgment {
  ok: boolean;
  findings: CriterionFinding[];
  evaluated?: number;
  error?: string;
}

export declare function judgeArtifactCriteria(options: {
  provider?: string | null;
  endpoint: string;
  apiKey: string;
  model?: string | null;
  skillText: unknown;
  artifactText: unknown;
  routeAt?: number | null;
  timeoutMs?: number;
  fetchImpl?: unknown;
}): Promise<CriteriaJudgment>;

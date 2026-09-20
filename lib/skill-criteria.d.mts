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

export type QuestionContract = {
  stage: string;
  id: string;
  kind: "human-ask" | "agent-receipt" | "skip";
  modes: string[];
  /** @deprecated Use exploration_min_count. Kept for old catalogs. */
  appetite?: string[];
  exploration_min_count?: number;
  evidence?: string;
  receipt: string;
};

export function requiredForStage(input?: { stage?: string; reviewMode?: string | string[]; appetite?: string; explorationCount?: number; kind?: QuestionContract["kind"] }): Array<Pick<QuestionContract, "id" | "kind" | "receipt">>;

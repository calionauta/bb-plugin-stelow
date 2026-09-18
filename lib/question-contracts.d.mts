export type QuestionContract = {
  stage: string;
  id: string;
  kind: "human-ask" | "agent-receipt" | "skip";
  modes: string[];
  appetite?: string[];
  evidence?: string;
  receipt: string;
};

export function requiredForStage(input?: { stage?: string; reviewMode?: string | string[]; appetite?: string; kind?: QuestionContract["kind"] }): Array<Pick<QuestionContract, "id" | "kind" | "receipt">>;

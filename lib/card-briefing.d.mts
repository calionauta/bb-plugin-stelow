export declare const BRIEFING_MAX_CHARS: number;

export declare function commsDisabled(env?: NodeJS.ProcessEnv): boolean;

export declare function renderFacts(facts: unknown[]): string;

export declare function buildBriefingPrompt(input: {
  cardName: string;
  summary: string;
  facts: unknown[];
}): string;

export declare function validateBriefingOutput(output: unknown): {
  ok: boolean;
  text: string;
  error?: string;
  truncated?: boolean;
};

export declare function wireFacts(facts: unknown[]): Array<{
  kind: "stage" | "question" | "answer" | "blocked" | "resumed" | "error" | "completed";
  at: number;
  text: string | null;
  stage: string | null;
  open: boolean | null;
}>;

export declare function briefingResult(input: {
  prose: unknown;
  facts: ReturnType<typeof wireFacts>;
  summary: string;
  source: string;
}): {
  summary: string;
  facts: ReturnType<typeof wireFacts>;
  prose: string | null;
  source: string;
};

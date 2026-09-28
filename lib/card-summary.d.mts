export type SummaryTone = "destructive" | "warning" | "success" | "default" | "muted";
export type SummaryPart = { tone: SummaryTone; text: string };
export type SummaryBlocker = { kind: "decision" | "error" | "paused"; text: string };
export type CardSummaryModel = {
  blocker: SummaryBlocker | null;
  stage: string | null;
  terminal: boolean;
  run: SummaryPart[] | null;
  files: number | null;
  scoped: string | null;
};

export declare function cardBlocker(input: {
  heroKind?: string | null;
  pendingQuestions?: number;
  expiredQuestions?: number;
  activity?: string;
}): SummaryBlocker | null;
export declare function runTally(runs: unknown): SummaryPart[] | null;
export declare function deliverableCount(artifacts: unknown): number | null;
export declare function scopeTally(scopes: unknown): string | null;
export declare function cardSummary(input: {
  heroKind: string | null;
  activity: string;
  status: string;
  stage: string;
  runs: unknown;
  artifacts: unknown;
  scopes: unknown;
  pendingQuestions: number;
  expiredQuestions: number;
  stageLabel: (stage: string) => string;
}): CardSummaryModel | null;

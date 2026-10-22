export type ReviewPolicy = string | string[];
export type Move = { verb: "next" | "accept" | "reject" | "rework"; target: string };
export declare const INTENT_ROUTES: Readonly<Record<string, readonly string[]>>;
export declare function stagesThatDoNotRun(gates: ReviewPolicy): string[];
export declare function stagesThatDoNotRunForMode(reviewMode: string): string[];
export declare function absentStages(reviewPolicy: ReviewPolicy | null | undefined): string[];
export declare function legalMoves(input: {
  intent: string;
  reviewPolicy: ReviewPolicy | null;
  stage: string;
}): { allowed: string[]; forward: string[] };

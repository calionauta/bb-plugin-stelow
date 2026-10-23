export type ReviewPolicy = string | string[];
export type Move = { verb: "next" | "accept" | "reject" | "rework"; target: string };
export declare const INTENT_ROUTES: Readonly<Record<string, readonly string[]>>;
export declare function legalMoves(input: {
  intent: string;
  reviewPolicy: ReviewPolicy | null;
  stage: string;
  quality?: string | null;
  explorationCount?: string | number | null;
}): { allowed: string[]; forward: string[] };

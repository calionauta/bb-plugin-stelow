export declare const INTENT_ROUTES: Record<string, string[]>;
export declare const MODE_SKIPS: Record<string, string[]>;
export declare const NON_AUTO_SKIPS: string[];
export declare const REVIEW_MODES: string[];
export declare function skipReason(stage: string, reviewMode: string): string;
export declare function skippedStages(input: {
  kind: unknown;
  intent: unknown;
  reviewMode: unknown;
  sequence: unknown;
}): { offRoute: string[]; skipped: Array<{ stage: string; reason: string }> };

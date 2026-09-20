export declare const DECISION_POINT_TRIAGE_INTENT: string;
export declare const DECISION_POINT_ARTIFACT_CRITERIA: string;
export declare const DECISION_POINT_MODES: string[];

export interface DecisionPoint {
  id: string;
  label: string;
  description: string;
  modes: string[];
  defaultMode: string;
  defaultThresholds: Record<string, number>;
}

export declare const DECISION_POINTS: DecisionPoint[];

export declare function isDecisionPoint(id: unknown): boolean;

export declare function getDecisionPoint(id: string): DecisionPoint | null;

export declare function normalizePointMode(mode: unknown, fallback?: string): string;

export declare function defaultThresholdsFor(id: string): Record<string, number>;

export declare function normalizeThresholds(input: unknown, fallback?: Record<string, number> | null): Record<string, number>;

export declare const TRIAGE_INTENT_CRITERIA: Record<string, string>;

export declare function triageIntentQuestions(): Record<string, unknown>;

export interface SeedIntentResolution {
  intent: string;
  source: "api" | "rules";
  confidence: number | null;
}

export declare function resolveSeedIntent(options: {
  apiAnswers?: Record<string, { type?: string; choice?: string; confidence?: number | null } | null> | null;
  routeAt?: number | null;
}): SeedIntentResolution;

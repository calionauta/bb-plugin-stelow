export declare const DECISION_POINT_TRIAGE_INTENT: string;
export declare const DECISION_POINT_ARTIFACT_CRITERIA: string;
export declare const DECISION_POINT_AUTO_CONTINUE: string;
export declare const DECISION_POINT_INBOX_SEVERITY: string;
export declare const DECISION_POINT_RETRY_TRANSIENT: string;
export declare const DECISION_POINT_PRESET_TIER: string;
export declare const DECISION_POINT_MODES: string[];

export declare const PRESET_JUDGE_POINTS: string[];

export declare function pointSupportsPresetJudge(id: unknown): boolean;

export declare function modesForPoint(id: string): string[];

export declare function questionKindsForPoint(id: string): string[];

export declare function questionKindsForPoint(id: string): string[];

export declare function needsSchemaForPoint(id: string): string;

export declare function pointsServedBySchema(schema: string): string[];

export interface DecisionPointRoute {
  provider: string | null;
  endpoint: string | null;
  apiKey: string | null;
  model: string | null;
}

export declare function normalizePointRoute(input: unknown): DecisionPointRoute;

export declare function resolvePointRoute(options: {
  override?: Partial<DecisionPointRoute> | null;
  fallback?: Partial<DecisionPointRoute> | null;
}): DecisionPointRoute;

export interface DecisionPoint {
  id: string;
  label: string;
  description: string;
  rules: string;
  requires?: string | null;
  /**
   * How to read the threshold slider for THIS point. The direction is not
   * uniform across points, so a single shared label would misdescribe
   * auto-continue; the wording lives beside the point it describes.
   */
  thresholdLabel: string;
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
  source: "api" | "preset" | "rules";
  confidence: number | null;
}

export declare function resolveSeedIntent(options: {
  apiAnswers?: Record<string, { type?: string; choice?: string; confidence?: number | null } | null> | null;
  routeAt?: number | null;
}): SeedIntentResolution;

export declare function autoContinueQuestions(): Record<string, unknown>;

export declare function severityBumpQuestions(): Record<string, unknown>;

export interface AutoContinueResolution {
  proceed: boolean;
  source: "api" | "rules";
  confidence?: number | null;
}

export declare function resolveAutoContinue(options: {
  apiNoul?: number | null;
  routeAt?: number | null;
}): AutoContinueResolution;

export declare function retryTransientQuestions(): Record<string, unknown>;

export interface RetryTransientResolution {
  retry: boolean;
  source: "api" | "rules";
  confidence?: number | null;
}

export declare function resolveRetryTransient(options: {
  apiNoul?: number | null;
  routeAt?: number | null;
}): RetryTransientResolution;

export declare const PRESET_TIER_CRITERIA: Record<string, string>;

export declare function presetTierQuestions(): Record<string, unknown>;

export interface PresetTierResolution {
  tier: string | null;
  source: "api" | "rules";
  confidence: number | null;
}

export declare function resolvePresetTier(options: {
  apiAnswers?: Record<string, { type?: string; choice?: string; confidence?: number | null } | null> | null;
  routeAt?: number | null;
}): PresetTierResolution;

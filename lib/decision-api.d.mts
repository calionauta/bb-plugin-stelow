export declare const DECISION_API_DEFAULT_ENDPOINT: string;
export declare const DECISION_API_DEFAULT_MODEL: string;
export declare const DECISION_API_TIMEOUT_MS: number;
export declare const DECISION_STATE_MAX_CHARS: number;
export declare const DECISION_API_KEY_ENV_VARS: string[];

export interface DecisionProvider {
  id: string;
  label: string;
  schema: "jev" | "labels";
  defaultEndpoint: string;
  defaultModel: string;
  needsKey: boolean;
  takesModel: boolean;
}

export declare const DECISION_PROVIDERS: DecisionProvider[];

export declare function providerById(id: unknown): DecisionProvider | null;

export declare function providerSchema(provider: unknown): "jev" | "labels";
export declare const CLASSIFIER_DEFAULT_ENDPOINT: string;

export declare function normalizeDecisionProvider(value: unknown, fallback?: string): string;

export declare function providerRequiresKey(provider: unknown): boolean;

export declare function defaultEndpointFor(provider: unknown): string;

export declare function defaultModelFor(provider: unknown): string;

export declare function providerTakesModel(provider: unknown): boolean;

export declare function isDecisionApiDisabled(env?: Record<string, string | undefined> | null): boolean;

export interface DecisionApiKeyResolution {
  key: string | null;
  source: "settings" | "env" | null;
}

export declare function resolveDecisionApiKey(options: {
  storedKey?: string | null;
  env?: Record<string, string | undefined> | null;
}): DecisionApiKeyResolution;

export declare function isDecisionApiEndpointValid(value: unknown): boolean;

export declare function normalizeDecisionApiModel(value: unknown, fallback: string): string;

export interface DecisionApiRequest {
  state: string;
  model: string;
  questions: Record<string, unknown>;
}

export declare function buildDecisionRequest(options: {
  state: unknown;
  questions?: Record<string, unknown> | null;
  model?: string | null;
}): DecisionApiRequest;

export interface DecisionApiAnswer {
  type: "choice" | "score" | "noul";
  choice?: string;
  score?: number;
  noul?: number;
  probabilities?: Record<string, number> | null;
  confidence?: number | null;
}

export interface DecisionApiParsed {
  ok: boolean;
  answers?: Record<string, DecisionApiAnswer | null>;
  model?: string | null;
  error?: string;
}

export declare function normalizeDecisionAnswer(answer: unknown): DecisionApiAnswer | null;

export declare function parseDecisionResponse(body: unknown): DecisionApiParsed;

export declare function meetsDecisionThreshold(confidence: unknown, threshold: unknown): boolean;

export interface ClassifierRequest {
  ok: boolean;
  id?: string;
  body?: Record<string, unknown>;
  error?: string;
}

export declare function buildClassifierRequest(options: {
  state: unknown;
  questions?: Record<string, unknown> | null;
}): ClassifierRequest;

export declare function parseClassifierResponse(body: unknown, id: string, criteria: unknown): DecisionApiParsed;

export interface ProbeCall {
  state: string;
  questions: Record<string, unknown>;
}

export declare function buildProbeCall(provider: unknown): ProbeCall;

export interface DecisionApiResult {
  ok: boolean;
  answers?: Record<string, DecisionApiAnswer | null>;
  model?: string | null;
  latencyMs?: number;
  error?: string;
}

export declare function evaluateDecisionCall(options: {
  provider?: string | null;
  endpoint: string;
  apiKey: string;
  model?: string | null;
  state: unknown;
  questions?: Record<string, unknown> | null;
  timeoutMs?: number;
  fetchImpl?: unknown;
}): Promise<DecisionApiResult>;

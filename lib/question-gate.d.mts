/* from lib/question-presence.d.mts */
export declare function questionOpenGuard(counts: {
  liveInteractions: number;
  expiredQuestions: number;
}): {
  canOpen: boolean;
  reason: string | null;
};

/* from lib/ask-gate.d.mts */
export declare function decideAskGate(input: {
  liveCount?: unknown;
  expiredCount?: unknown;
  kind?: unknown;
  intent?: unknown;
  stage?: unknown;
  tag?: unknown;
  forced?: unknown;
  groups?: unknown;
  reviewMode?: unknown;
}): { allowed: boolean; reason: string | null; code: 0 | 1 | 2 };

/* from lib/scope-ask-gate.d.mts */
/** The machine tag for scope IN/OUT confirms. */
export declare const SCOPE_ADJUST_TAG: "scope-adjust";

/** Pattern 3 chunks at six options per question; never drop items to fit. */
export declare const SCOPE_ASK_MAX_OPTIONS: 6;

/** Refuse a malformed scope confirm, or one asked in the wrong mode. */
export declare function scopeAskRefusal(input: {
  tag: unknown;
  reviewMode: unknown;
  groups: unknown;
}): string | null;

/* from lib/ask-cancel.d.mts */
export declare const TRANSIENT_CANCEL_REASONS: string[];
export declare function classifyAskCancel(outcome: string, reason: string | null, requestFailed?: boolean): "persist" | "passthrough";
export declare function interruptionWhy(reason: string | null, requestFailed: boolean, elapsedSecs: number): string;
export declare function isRetryablePersistError(message: unknown): boolean;


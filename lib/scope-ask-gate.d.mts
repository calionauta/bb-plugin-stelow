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

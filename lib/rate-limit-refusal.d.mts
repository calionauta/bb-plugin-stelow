export function retryWindowFromError(message: unknown): { seconds: number; hours: number } | null;
export function isRateLimitFailure(message: unknown): boolean;
export function rateLimitAdvice(message: unknown): string | null;
/** A provider refusing on account balance: no clock and no Retry clears it. */
export function isQuotaFailure(message: unknown): boolean;
/** The sentence that names the only card-side fix for a quota refusal. */
export function quotaAdvice(message: unknown): string | null;

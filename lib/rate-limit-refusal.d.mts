export function retryWindowFromError(message: unknown): { seconds: number; hours: number } | null;
export function isRateLimitFailure(message: unknown): boolean;
export function rateLimitAdvice(message: unknown): string | null;

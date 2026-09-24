export function scopeElapsedMs(scope: { status?: string; startedAt?: string | null; record?: { completedAt?: string | null } | null }, nowMs?: number): number | null;
export function totalScopeElapsedMs(scopes: Array<{ status?: string; startedAt?: string; record?: { completedAt?: string } | null }>, nowMs?: number): number | null;

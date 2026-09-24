function timestampMs(value) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const parsed = typeof value === "number" ? value : Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function scopeElapsedMs(scope, nowMs = Date.now()) {
  const startedAt = timestampMs(scope?.startedAt);
  if (startedAt === null) return null;
  const completedAt = timestampMs(scope?.record?.completedAt);
  if (completedAt !== null) return Math.max(0, completedAt - startedAt);
  return ["in-progress", "blocked", "failed", "escalated"].includes(scope?.status ?? "")
    ? Math.max(0, nowMs - startedAt)
    : null;
}

export function totalScopeElapsedMs(scopes, nowMs = Date.now()) {
  const intervals = (scopes ?? []).flatMap((scope) => {
    const startedAt = timestampMs(scope?.startedAt);
    if (startedAt === null) return [];
    const completedAt = timestampMs(scope?.record?.completedAt);
    return [{
      startedAt,
      completedAt: completedAt ?? (["in-progress", "blocked", "failed", "escalated"].includes(scope?.status ?? "") ? nowMs : null),
    }];
  }).filter((interval) => interval.completedAt !== null);
  if (intervals.length === 0) return null;
  return Math.max(...intervals.map((interval) => interval.completedAt)) - Math.min(...intervals.map((interval) => interval.startedAt));
}

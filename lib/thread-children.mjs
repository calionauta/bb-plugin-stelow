/**
 * Child-thread surfacing for worker history. On BB-backed hosts a worker
 * may fan work out to fresh child threads (see upstream
 * `subagents.md#bb-child-thread-substrate`); the parent synthesizes, so
 * the card must show each child to stay observable. Pure shaping —
 * fetching stays in server.ts next to workerTokenUsage, fail-open.
 */

export const MAX_CHILDREN = 10;

export function shapeChildThreads(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((thread) => thread && typeof thread === "object" && typeof thread.id === "string" && !thread.deletedAt)
    .slice(0, MAX_CHILDREN)
    .map((thread) => ({
      threadId: thread.id,
      title: typeof thread.title === "string"
        ? thread.title
        : typeof thread.titleFallback === "string" ? thread.titleFallback : null,
      status: typeof thread.status === "string" ? thread.status : "unknown",
      providerId: typeof thread.providerId === "string" ? thread.providerId : null,
    }));
}

/**
 * Attach per-child token totals fetched separately (token events live on
 * each child thread, not on the parent listing). Pure merge: unknown stays
 * null, never zero — same honesty rule as the worker rows.
 */
export function attachChildTokenUsage(children, usageById) {
  if (!Array.isArray(children)) return [];
  const usage = usageById !== null && typeof usageById === "object" ? usageById : {};
  return children.map((child) => ({
    ...child,
    tokenUsage: Number.isFinite(usage[child?.threadId]) && usage[child.threadId] >= 0 ? usage[child.threadId] : null,
  }));
}

// Breakdown sibling: attaches the provider split per child for the card
// total. Shape mirrors the totals above — one pure merge each, never a
// combined mega-function — and breakdowns validate leg by leg.
export function attachChildTokenBreakdown(children, breakdownById) {
  if (!Array.isArray(children)) return [];
  const byId = breakdownById !== null && typeof breakdownById === "object" ? breakdownById : {};
  const clean = (value) => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null);
  return children.map((child) => {
    const raw = byId[child?.threadId] ?? null;
    if (!raw || typeof raw !== "object") return { ...child, tokenBreakdown: null };
    const breakdown = {
      input: clean(raw.input),
      output: clean(raw.output),
      cached: clean(raw.cached),
      reasoning: clean(raw.reasoning),
      total: clean(raw.total),
    };
    const known = breakdown.input !== null || breakdown.output !== null || breakdown.cached !== null || breakdown.reasoning !== null || breakdown.total !== null;
    return { ...child, tokenBreakdown: known ? breakdown : null };
  });
}

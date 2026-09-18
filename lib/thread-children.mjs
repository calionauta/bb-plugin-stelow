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

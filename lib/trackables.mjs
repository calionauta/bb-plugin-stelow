/**
 * Central trackable machine (pure, no I/O).
 *
 * Every pendency the workflow tracks — stage, scope, task,
 * acceptance-criterion, gap, question, review, verification — is a
 * trackable with one status vocabulary, one transition table, and one
 * condition shape. Kind-specific differences (what evidence a `done`
 * requires, who may write) live as data in lib/trackable-contracts.mjs;
 * this module never branches on kind.
 *
 * Ownership rule: `done` and `completed` are terminal aliases. A finished
 * trackable never regresses — corrections open a new trackable (rework
 * scope, hotfix task), they do not reopen history.
 */

export const TRACKABLE_STATUSES = [
  "pending",
  "in-progress",
  "blocked",
  "done",
  "completed",
  "skipped",
  "failed",
  "escalated",
];

/** Terminal-good statuses. Every "is it finished" check reads this. */
export function isDoneStatus(status) {
  return status === "done" || status === "completed";
}

/** Explicitly set aside. Done-gates treat it as resolved; sync-gates do not. */
export function isSkippedStatus(status) {
  return status === "skipped";
}

/** Claimed by a live worker. The only status that means "happening now". */
export function isActiveStatus(status) {
  return status === "in-progress";
}

export function isKnownStatus(status) {
  return TRACKABLE_STATUSES.includes(status);
}

/**
 * Canonical id shape for every trackable (`scope-1`, `scope-1-t1`, `3.1`).
 * Single owner: relations, evidence, paths, and gates validate through
 * this instead of per-module regexes. Null when unusable — never throws.
 */
export function cleanTrackableId(value) {
  const id = typeof value === "string" ? value.trim() : "";
  return /^[A-Za-z0-9_.-]{1,80}$/.test(id) ? id : null;
}

// Allowed transitions. Permissive where the workflow loops back
// (blocked/failed/escalated/skipped may resume), terminal where history
// must hold (done/completed never exit — open a new trackable instead).
const TRANSITIONS = {
  pending: ["in-progress", "blocked", "skipped", "done", "completed"],
  "in-progress": ["blocked", "failed", "escalated", "skipped", "done", "completed", "pending"],
  blocked: ["in-progress", "skipped", "failed"],
  failed: ["in-progress", "skipped"],
  escalated: ["in-progress", "skipped", "done", "completed"],
  skipped: ["in-progress", "pending"],
  done: [],
  completed: [],
};

/** Whether a status change is legal. Unknown statuses never transition. */
export function canTransition(from, to) {
  if (!isKnownStatus(from) || !isKnownStatus(to)) return false;
  if (from === to) return true;
  return (TRANSITIONS[from] ?? []).includes(to);
}

/**
 * A k8s-style condition: presence in a trackable's conditions[] asserts
 * the named fact, absence asserts nothing. No severity levels, no guessing
 * — an unknown card carries no conditions, never an invented headline.
 */
export function buildCondition(options = {}) {
  const { type, reason, message, observedAt } = (options && typeof options === "object" ? options : {});
  if (typeof type !== "string" || !type) return null;
  return {
    type,
    reason: typeof reason === "string" && reason ? reason : type,
    message: typeof message === "string" && message ? message : type,
    observedAt: typeof observedAt === "string" && observedAt ? observedAt : new Date().toISOString(),
  };
}

/** Whether a conditions list asserts the named type. */
export function hasCondition(conditions, type) {
  return Array.isArray(conditions) && conditions.some((condition) => condition && typeof condition === "object" && condition.type === type);
}

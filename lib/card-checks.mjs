/**
 * Card checks grouping (pure, no DB).
 *
 * One "what needs doing" rollup per card, grouped by check type with
 * done/pending counts — the same sources the heroes read (pending
 * questions, scope states, gap summary), never a second truth. Groups
 * with no applicable items resolve absent (not empty): a review row on
 * an unstarted card would be noise, not information.
 */
import { isActiveStatus, isDoneStatus } from "./trackables.mjs";

function text(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function scopeItems(scopes) {
  const list = Array.isArray(scopes) ? scopes : [];
  const open = [];
  let done = 0;
  for (const scope of list) {
    if (!scope || typeof scope !== "object") continue;
    if (isDoneStatus(scope.status)) { done += 1; continue; }
    const name = text(scope.name) ?? text(scope.id) ?? "Untitled scope";
    open.push(name);
  }
  return { open, done, total: open.length + done };
}

function taskItems(scopes) {
  const list = Array.isArray(scopes) ? scopes : [];
  const open = [];
  let done = 0;
  for (const scope of list) {
    if (!scope || typeof scope !== "object") continue;
    for (const task of Array.isArray(scope.tasks) ? scope.tasks : []) {
      if (!task || typeof task !== "object") continue;
      const name = text(task.name) ?? "Untitled task";
      if (isDoneStatus(task.status)) done += 1;
      else open.push(name);
    }
  }
  return { open, done, total: open.length + done };
}

/**
 * Descriptions of the gaps still asking for work, or null when the card has no
 * matched gap set at all.
 *
 * Only an escalation is open work. A fixed or documented gap is closed by the
 * disposition the critique recorded, and an escalation closes when its rework
 * scope finishes — listing the settled ones as open told the reader a card was
 * waiting on findings nobody has to act on.
 */
function openGapDescriptions(gaps) {
  if (!gaps || typeof gaps !== "object" || gaps.matched !== true) return null;
  return (Array.isArray(gaps.items) ? gaps.items : [])
    .filter(isOpenGap)
    .map((item) => text(item.description))
    .filter((description) => description !== null);
}

/** An escalation is open until its rework scope finishes. */
function isOpenGap(item) {
  if (!item || typeof item !== "object" || item.resolution !== "escalate") return false;
  return text(item.scopeStatus) === null || !isDoneStatus(item.scopeStatus);
}

/**
 * Gaps this card owes no work on: fixed, documented, and escalations whose
 * rework scope is done — counted from the items themselves so the rollup's
 * done/open/total cannot drift apart. The server's fixed/documented counters
 * are the fallback for a payload without items.
 */
function settledGapCount(gaps) {
  // The server's fixed/documented counters are authoritative for the gaps it
  // counted — `items` can be a shorter list (a cap, or a payload built before
  // the list carried every gap), and treating the shorter list as the whole
  // truth would UNDER-report done work. What only the items know, and the
  // counters cannot, is an escalation whose rework scope has since finished:
  // that one is added on top.
  const byResolution = typeof gaps.fixed === "number" && typeof gaps.documented === "number"
    ? gaps.fixed + gaps.documented
    : 0;
  const items = Array.isArray(gaps.items) ? gaps.items : [];
  const closedEscalations = items.filter((item) => (
    item && typeof item === "object"
    && item.resolution === "escalate"
    && text(item.scopeStatus) !== null
    && isDoneStatus(item.scopeStatus)
  )).length;
  return byResolution + closedEscalations;
}

/**
 * The Gaps row, or null when the card has no matched gap set.
 *
 * `done + open` must equal `total`, or the row reads "1/4 open" against one
 * name and the reader cannot reconcile it — the same accounting failure the gap
 * section itself was fixed for. `doneCount` therefore counts the gaps this card
 * owes no work on, and the clamp keeps the identity true even when the server's
 * counters and its item list describe different totals.
 */
function gapChecksGroup(gaps) {
  const open = openGapDescriptions(gaps);
  if (open === null) return null;
  const visible = open.slice(0, 20);
  const total = typeof gaps.total === "number" ? gaps.total : open.length;
  const settled = Math.min(settledGapCount(gaps), Math.max(0, total - Math.min(visible.length, total)));
  return { id: "gaps", label: "Gaps", open: visible, doneCount: settled, total };
}

export function groupCardChecks({ questions, scopes, gaps, review }) {
  const pending = Array.isArray(questions) ? questions : [];
  const groups = [];
  const scope = scopeItems(scopes);
  if ((Array.isArray(scopes) ? scopes.length : 0) > 0) {
    groups.push({
      id: "scopes",
      label: "Scopes",
      open: scope.open,
      doneCount: scope.done,
      total: scope.total,
    });
  }
  const tasks = taskItems(scopes);
  if (tasks.total > 0) {
    groups.push({
      id: "tasks",
      label: "Tasks",
      open: tasks.open,
      doneCount: tasks.done,
      total: tasks.total,
    });
  }
  const titles = pending
    .map((question) => (question && typeof question === "object" ? text(question.title) ?? text(question.question) : null))
    .filter((title) => title !== null);
  if (titles.length > 0) {
    groups.push({ id: "questions", label: "Questions", open: titles, doneCount: 0, total: titles.length });
  }
  const gapGroup = gapChecksGroup(gaps);
  if (gapGroup) groups.push(gapGroup);
  // Review state arrives pre-resolved (completed + unreviewed = pending):
  // the card knows its review, the grouping only names it.
  if (review && typeof review === "object" && (review.pending === true || review.done === true)) {
    groups.push({
      id: "review",
      label: "Review",
      open: review.pending === true ? ["Final review"] : [],
      doneCount: review.done === true ? 1 : 0,
      total: 1,
    });
  }
  return groups;
}

// Stalled-execution signal (pure): a running worker with synced scopes but
// nothing ever marked — neither in-progress nor done — is executing past
// its tracking, the exact shape of a done-with-pending-scopes surprise.
// Advisory only: the Checks section names it, nothing refuses on it.
// Skipped scopes do not count as marking: skipping everything while
// running is the same silence with extra steps.
export function isExecutionUntracked({ activity, scopes }) {
  if (activity !== "running") return false;
  const list = Array.isArray(scopes) ? scopes.filter((scope) => scope && typeof scope === "object") : [];
  if (list.length === 0) return false;
  return !list.some((scope) => isActiveStatus(scope.status) || isDoneStatus(scope.status));
}

// A group reads done only when it has items and none are open — an empty
// group is absent upstream, never "done".
export function groupState(group) {
  if (!group || typeof group !== "object") return "empty";
  if (!Array.isArray(group.open)) return "empty";
  return group.open.length === 0 ? "done" : "pending";
}

// Missing-tracking signal: REMOVED, and its removal is the point.
//
// This used to alarm on any card with no synced scopes whose stage was
// execution, verification, or audit, and it read nothing but the stage. A card
// can be at audit without ever having planned — an investigation goes
// triage → select → setup → context → audit, and its own state.md records
// `planning: pending` — so the rule told readers their planning had used
// headings instead of machine blocks, on cards with no tech spec at all.
//
// Emptiness is not evidence. The server already classifies scope sync properly
// (`diagnoseScopeSync` → no-spec / no-blocks / ok / unsynced / human-dialect)
// and the panel renders `scopeSyncNotice` from it. One fact, one representation:
// the classification is the decision, and it lives in lib/scope-sync-notice.mjs.

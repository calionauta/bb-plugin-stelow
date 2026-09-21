/**
 * Card checks grouping (pure, no DB).
 *
 * One "what needs doing" rollup per card, grouped by check type with
 * done/pending counts — the same sources the heroes read (pending
 * questions, scope states, gap summary), never a second truth. Groups
 * with no applicable items resolve absent (not empty): a review row on
 * an unstarted card would be noise, not information.
 */

function text(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function scopeItems(scopes) {
  const list = Array.isArray(scopes) ? scopes : [];
  const isDone = (status) => status === "done" || status === "completed";
  const open = [];
  let done = 0;
  for (const scope of list) {
    if (!scope || typeof scope !== "object") continue;
    if (isDone(scope.status)) { done += 1; continue; }
    const name = text(scope.name) ?? text(scope.id) ?? "Untitled scope";
    open.push(name);
  }
  return { open, done, total: open.length + done };
}

function taskItems(scopes) {
  const list = Array.isArray(scopes) ? scopes : [];
  const isDone = (status) => status === "done" || status === "completed";
  const open = [];
  let done = 0;
  for (const scope of list) {
    if (!scope || typeof scope !== "object") continue;
    for (const task of Array.isArray(scope.tasks) ? scope.tasks : []) {
      if (!task || typeof task !== "object") continue;
      const name = text(task.name) ?? "Untitled task";
      if (isDone(task.status)) done += 1;
      else open.push(name);
    }
  }
  return { open, done, total: open.length + done };
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
  const gapItems = gaps && typeof gaps === "object" && gaps.matched === true
    ? (Array.isArray(gaps.items) ? gaps.items : [])
      .map((item) => (item && typeof item === "object" ? text(item.description) : null))
      .filter((description) => description !== null)
    : null;
  if (gapItems !== null) {
    const openGaps = gapItems.slice(0, 20);
    groups.push({
      id: "gaps",
      label: "Gaps",
      open: openGaps,
      doneCount: typeof gaps.fixed === "number" && typeof gaps.documented === "number" ? gaps.fixed + gaps.documented : 0,
      total: typeof gaps.total === "number" ? gaps.total : openGaps.length,
    });
  }
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
  return !list.some((scope) => ["in-progress", "done", "completed"].includes(scope.status));
}

// A group reads done only when it has items and none are open — an empty
// group is absent upstream, never "done".
export function groupState(group) {
  if (!group || typeof group !== "object") return "empty";
  if (!Array.isArray(group.open)) return "empty";
  return group.open.length === 0 ? "done" : "pending";
}

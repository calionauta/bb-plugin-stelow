/**
 * Host-side reader for spec-tech scope blocks (pure, no I/O).
 *
 * The vendored `sync-scopes` parser is the single canonical *writer* of
 * `stelow.json` tracking and only understands literal `^[SCOPE-N]` blocks.
 * LLMs following the tech-planning output template instead write human
 * headings (`### SCOPE-1: Title`), which sync silently skips (warn + exit 0)
 * — the exact shape of the invisible-scopes incident. This module is the
 * host's defensive *reader*: it recognizes both dialects for diagnosis,
 * extracts the contractually-required task tables (Task + Done Criterion
 * columns, enforced by the tech-planning artifact contract) into planned
 * tasks, and builds loud advance/done refusals that name the fix.
 *
 * It never writes tracking. Every refusal names a valid redirect — a
 * refusal without an exit is a deadlock with a good error message.
 */

const MACHINE_OPEN_RE = /^\[SCOPE-(\d+)\]\s*(.*)$/;
const HUMAN_OPEN_RE = /^#{1,6}\s*SCOPE-(\d+)\s*:?\s*(.*)$/;

function openBlock(line) {
  const machine = MACHINE_OPEN_RE.exec(line);
  if (machine) return { n: machine[1], title: machine[2].trim(), dialect: "machine" };
  const human = HUMAN_OPEN_RE.exec(line);
  if (human) return { n: human[1], title: human[2].trim(), dialect: "human" };
  return null;
}

/**
 * Split spec content into scope blocks. Accepts the machine dialect
 * (`[SCOPE-N] Title`) and the human dialect (`### SCOPE-N: Title`) the
 * planning template invites. Returns [{ n, title, body, dialect, line }]
 * with the 1-based opener line for fix-it refusals.
 */
export function splitScopeBlocks(content) {
  const blocks = [];
  let current = null;
  let lineNo = 0;
  for (const line of String(content ?? "").split("\n")) {
    lineNo += 1;
    const open = openBlock(line.trim());
    if (open) {
      if (current) blocks.push(current);
      current = { n: open.n, title: open.title, dialect: open.dialect, body: "", line: lineNo };
      continue;
    }
    if (current) current.body += `${line}\n`;
  }
  if (current) blocks.push(current);
  return blocks;
}

/** 1-based lines opening human-dialect scopes (capped, for refusals). */
export function humanScopeLines(content, limit = 5) {
  const lines = [];
  for (const block of splitScopeBlocks(content)) {
    if (block.dialect !== "human") continue;
    if (lines.length >= limit) break;
    lines.push(block.line);
  }
  return lines;
}

/** Count machine vs human scope blocks ({ machine, human }). */
export function countScopeDialects(content) {
  const counts = { machine: 0, human: 0 };
  for (const block of splitScopeBlocks(content)) {
    if (block.dialect === "machine") counts.machine += 1;
    else counts.human += 1;
  }
  return counts;
}

function headerCells(line) {
  return line.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim().toLowerCase());
}

function isSeparator(line) {
  const cells = line.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());
  return cells.length > 0 && cells.every((cell) => /^:?-+:?$/.test(cell));
}

function rowCells(line) {
  return line.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());
}

/**
 * Extract planned tasks from a scope block body. Only tables carrying both
 * a Task column and a Done Criterion column qualify — the same columns the
 * tech-planning artifact contract requires, so a passing spec is parseable
 * by construction. Returns [{ id, name, kind, note?, status, source }]; Done
 * Criterion becomes the task note the ScopesList already renders. Planned tasks
 * carry the same explicit kind as tracked tasks so the card-detail contract
 * never has to repair them at the edge.
 */
export function parseScopeTasks(blockBody, scopeId) {
  const tasks = [];
  const lines = String(blockBody ?? "").split("\n");
  for (let i = 0; i < lines.length - 1; i++) {
    if (!lines[i].trim().startsWith("|") || !isSeparator(lines[i + 1])) continue;
    const headers = headerCells(lines[i]);
    const taskIdx = headers.findIndex((cell) => cell.includes("task"));
    const doneIdx = headers.findIndex((cell) => cell.includes("done") && cell.includes("criter"));
    if (taskIdx < 0 || doneIdx < 0) continue;
    // A leading "#" column carries the AUTHOR's own task ids (`3.1`). Those are
    // the ids a worker will seed with, so reading them is what makes the merge
    // below a no-op instead of a duplication.
    //
    // It used to be ignored and every id invented as `scope-N-tM`. A worker that
    // seeded `3.1` therefore matched on neither id nor name, and the card showed
    // every spec task twice: 33 done beside 19 phantom pendings, under a
    // "12/12 scopes complete" heading that was true about scopes and silent about
    // the tasks. The number that disagreed with its own scope count was the only
    // tell, and no gate caught it — only a reader looking at the card did.
    const idIdx = headers.findIndex((cell) => cell === "#" || cell === "id" || cell === "task id");
    let row = 0;
    for (let j = i + 2; j < lines.length && tasks.length < 100; j++) {
      const text = lines[j].trim();
      if (!text.startsWith("|") || isSeparator(lines[j])) break;
      const cells = rowCells(lines[j]);
      const name = (cells[taskIdx] ?? "").trim();
      if (!name) continue;
      row += 1;
      const declared = idIdx >= 0 ? (cells[idIdx] ?? "").trim() : "";
      const id = declared || `${scopeId}-t${row}`;
      const criterion = (cells[doneIdx] ?? "").trim();
      const task = { id, name, kind: "task", status: "pending", source: "planned" };
      if (criterion) task.note = `Done: ${criterion}`;
      tasks.push(task);
    }
  }
  return tasks;
}

/**
 * Diagnose the sync shape: machine blocks the writer understands vs human
 * headings it silently skips, against how many scopes actually synced.
 * States: ok | no-spec | no-blocks | human-dialect | unsynced.
 */
export function diagnoseScopeSync({ specContent, syncedCount } = {}) {
  const synced = typeof syncedCount === "number" ? syncedCount : 0;
  if (typeof specContent !== "string" || !specContent.trim()) {
    return { state: "no-spec", machine: 0, human: 0, synced };
  }
  const { machine, human } = countScopeDialects(specContent);
  if (machine > 0 && synced > 0) return { state: "ok", machine, human, synced };
  if (machine > 0) return { state: "unsynced", machine, human, synced };
  if (human > 0) return { state: "human-dialect", machine, human, synced };
  return { state: "no-blocks", machine, human, synced };
}

function taskId(task) {
  return String(task?.id ?? "").trim();
}

function taskName(task) {
  return String(task?.name ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Merge spec-table planned tasks into already-synced tracked scopes,
 * keyed by scope id (`scope-N`). Tracked tasks win on id conflict;
 * blocks without a synced scope invent nothing — the host never creates
 * tracking, it only enriches what the canonical parser wrote.
 *
 * Union is by id AND normalized name. Both keys are needed because a worker
 * seeds tasks with whatever id the spec declared (`3.1`) while an older spec
 * carries no id column at all and this reader falls back to `scope-N-tM`.
 *
 * The appended rows are `source: "planned"` — a projection of a document, not
 * something a worker did. That is what made the failure visible: a card read
 * "12/12 scopes complete" while counting 19 planned rows nobody had worked on,
 * and the two numbers disagreed with no explanation. So a planned row now
 * carries a note saying where it comes from, and `plannedTaskGhosts` names the
 * shape for the card to refuse rather than render as ordinary pending work.
 */
export function mergePlannedTasks(trackedScopes, specContent) {
  const tracked = Array.isArray(trackedScopes) ? trackedScopes : [];
  if (typeof specContent !== "string" || !specContent.trim()) return tracked;
  const plannedByScope = new Map();
  for (const block of splitScopeBlocks(specContent)) {
    const tasks = parseScopeTasks(block.body, `scope-${block.n}`);
    if (tasks.length > 0 && !plannedByScope.has(`scope-${block.n}`)) plannedByScope.set(`scope-${block.n}`, tasks);
  }
  if (plannedByScope.size === 0) return tracked;
  return tracked.map((scope) => {
    if (!scope || typeof scope !== "object") return scope;
    const planned = plannedByScope.get(scope.id);
    if (!planned) return scope;
    const existing = (Array.isArray(scope.tasks) ? scope.tasks : []).filter((task) => task && typeof task === "object");
    const haveIds = new Set(existing.map(taskId));
    const haveNames = new Set(existing.map(taskName));
    const merged = [...(Array.isArray(scope.tasks) ? scope.tasks : []), ...planned.filter((task) => !haveIds.has(taskId(task)) && !haveNames.has(taskName(task)))];
    return { ...scope, tasks: merged };
  });
}

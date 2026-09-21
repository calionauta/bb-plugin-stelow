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
 * planning template invites. Returns [{ n, title, body, dialect }].
 */
export function splitScopeBlocks(content) {
  const blocks = [];
  let current = null;
  for (const line of String(content ?? "").split("\n")) {
    const open = openBlock(line.trim());
    if (open) {
      if (current) blocks.push(current);
      current = { n: open.n, title: open.title, dialect: open.dialect, body: "" };
      continue;
    }
    if (current) current.body += `${line}\n`;
  }
  if (current) blocks.push(current);
  return blocks;
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
 * by construction. Returns [{ id, name, note?, status, source }]; Done
 * Criterion becomes the task note the ScopesList already renders.
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
    let row = 0;
    for (let j = i + 2; j < lines.length && tasks.length < 100; j++) {
      const text = lines[j].trim();
      if (!text.startsWith("|") || isSeparator(lines[j])) break;
      const cells = rowCells(lines[j]);
      const name = (cells[taskIdx] ?? "").trim();
      if (!name) continue;
      row += 1;
      const criterion = (cells[doneIdx] ?? "").trim();
      const task = { id: `${scopeId}-t${row}`, name, status: "pending", source: "planned" };
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

const SYNC_REDIRECT = "run `bb stelow sync-scopes`, then advance again";

/**
 * Refusal for entering execution without scope tracking, or null when the
 * advance may proceed. Build-only, execution-entry-only, and fail-open
 * whenever the spec is unreadable or absent (not every route plans through
 * spec-tech) — an unreadable spec must never become a false deadlock.
 */
export function executionScopeRefusal({ kind, stage, specContent, syncedCount } = {}) {
  if (kind !== "build" || stage !== "execution") return null;
  const diagnosis = diagnoseScopeSync({ specContent, syncedCount });
  if (diagnosis.state === "ok" || diagnosis.state === "no-spec" || diagnosis.state === "no-blocks") return null;
  if (diagnosis.state === "human-dialect") {
    return `Refused: spec-tech uses human headings (\`### SCOPE-N:\`) instead of machine blocks, so sync-scopes parsed 0 scopes and execution would run untracked. Rewrite each scope opener as \`[SCOPE-N] Title\` (see scopes-and-sequencing), ${SYNC_REDIRECT}.`;
  }
  return `Refused: spec-tech has ${diagnosis.machine} machine scope block(s) but 0 synced scopes — execution would run untracked. ${SYNC_REDIRECT[0].toUpperCase()}${SYNC_REDIRECT.slice(1)}.`;
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
 * Union is by id AND normalized name: the upstream scope-start seed writes
 * planned tasks with table ids (`3.1`) while this reader generates
 * `scope-N-tM` — without the name key the same task would render twice.
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

const STATES = ["queued", "running", "needs_input", "succeeded", "failed", "cancelled"];
const TRANSITIONS = {
  queued: new Set(["running", "needs_input", "failed", "cancelled"]),
  running: new Set(["queued", "needs_input", "succeeded", "failed", "cancelled"]),
  needs_input: new Set(["running", "failed", "cancelled"]),
  succeeded: new Set(),
  failed: new Set(),
  cancelled: new Set(),
};

export function ensureExecutionRunTable(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS execution_runs (
    id TEXT PRIMARY KEY,
    card_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    run_id TEXT,
    recipe_id TEXT NOT NULL,
    stage TEXT NOT NULL,
    source_hash TEXT NOT NULL,
    source_text TEXT NOT NULL,
    args_text TEXT NOT NULL,
    adapter TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    artifact_root TEXT NOT NULL,
    origin_thread_id TEXT NOT NULL,
    native_status TEXT,
    normalized_status TEXT NOT NULL CHECK (normalized_status IN ('queued','running','needs_input','succeeded','failed','cancelled')),
    started_at INTEGER NOT NULL,
    completed_at INTEGER,
    resume_of TEXT,
    error_code TEXT,
    preview_directive TEXT,
    completion_event_id TEXT,
    needs_input_sent_at INTEGER,
    resume_requested_at INTEGER,
    boundary_id TEXT,
    boundary_question TEXT,
    boundary_contract TEXT,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE
  )`);
  const columns = new Set(db.prepare("PRAGMA table_info(execution_runs)").all().map((column) => column.name));
  if (!columns.has("project_id")) db.exec("ALTER TABLE execution_runs ADD COLUMN project_id TEXT NOT NULL DEFAULT ''");
  if (!columns.has("source_text")) db.exec("ALTER TABLE execution_runs ADD COLUMN source_text TEXT NOT NULL DEFAULT ''");
  if (!columns.has("args_text")) db.exec("ALTER TABLE execution_runs ADD COLUMN args_text TEXT NOT NULL DEFAULT '{}'");
  if (!columns.has("artifact_root")) db.exec("ALTER TABLE execution_runs ADD COLUMN artifact_root TEXT NOT NULL DEFAULT ''");
  if (!columns.has("needs_input_sent_at")) db.exec("ALTER TABLE execution_runs ADD COLUMN needs_input_sent_at INTEGER");
  if (!columns.has("resume_requested_at")) db.exec("ALTER TABLE execution_runs ADD COLUMN resume_requested_at INTEGER");
  if (!columns.has("boundary_id")) db.exec("ALTER TABLE execution_runs ADD COLUMN boundary_id TEXT");
  if (!columns.has("boundary_question")) db.exec("ALTER TABLE execution_runs ADD COLUMN boundary_question TEXT");
  if (!columns.has("boundary_contract")) db.exec("ALTER TABLE execution_runs ADD COLUMN boundary_contract TEXT");
  db.exec("CREATE INDEX IF NOT EXISTS idx_execution_runs_card ON execution_runs(card_id, created_at DESC)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_execution_runs_active ON execution_runs(card_id, normalized_status)");
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_execution_runs_native ON execution_runs(run_id) WHERE run_id IS NOT NULL");
}

function jsonValue(value) {
  if (!value) return null;
  try { return JSON.parse(value); } catch { return null; }
}

function row(value) {
  return value ? {
    id: value.id,
    cardId: value.card_id,
    projectId: value.project_id,
    runId: value.run_id,
    recipeId: value.recipe_id,
    stage: value.stage,
    sourceHash: value.source_hash,
    sourceText: value.source_text,
    argsText: value.args_text,
    adapter: value.adapter,
    workspaceId: value.workspace_id,
    artifactRoot: value.artifact_root,
    originThreadId: value.origin_thread_id,
    nativeStatus: value.native_status,
    normalizedStatus: value.normalized_status,
    startedAt: value.started_at,
    completedAt: value.completed_at,
    resumeOf: value.resume_of,
    errorCode: value.error_code,
    previewDirective: value.preview_directive,
    completionEventId: value.completion_event_id,
    needsInputSentAt: value.needs_input_sent_at,
    resumeRequestedAt: value.resume_requested_at,
    boundaryId: value.boundary_id,
    boundaryQuestion: value.boundary_question,
    boundaryContract: jsonValue(value.boundary_contract),
    createdAt: value.created_at,
  } : null;
}

export function createExecutionRun(db, input) {
  if (!input?.id || !input.cardId || !input.projectId || !input.recipeId || !input.stage || !input.sourceHash || !input.sourceText || !input.argsText || !input.adapter || !input.workspaceId || !input.artifactRoot || !input.originThreadId) throw new Error("execution run identity is incomplete");
  const now = input.now ?? Date.now();
  if (!input.resumeOf && activeExecutionRun(db, input.cardId)) throw new Error("card already owns an active execution run");
  db.prepare(`INSERT INTO execution_runs (id, card_id, project_id, run_id, recipe_id, stage, source_hash, source_text, args_text, adapter, workspace_id, artifact_root, origin_thread_id, native_status, normalized_status, started_at, resume_of, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?)`)
    .run(input.id, input.cardId, input.projectId, input.runId ?? null, input.recipeId, input.stage, input.sourceHash, input.sourceText, input.argsText, input.adapter, input.workspaceId, input.artifactRoot, input.originThreadId, input.nativeStatus ?? null, now, input.resumeOf ?? null, now);
  return getExecutionRun(db, input.id);
}

export function getExecutionRun(db, id) {
  return row(db.prepare("SELECT * FROM execution_runs WHERE id = ?").get(id));
}

export function projectExecutionRun(value) {
  return {
    id: value.id,
    cardId: value.cardId,
    runId: value.runId,
    recipeId: value.recipeId,
    stage: value.stage,
    sourceHash: value.sourceHash,
    adapter: value.adapter,
    workspaceId: value.workspaceId,
    originThreadId: value.originThreadId,
    nativeStatus: value.nativeStatus,
    normalizedStatus: value.normalizedStatus,
    startedAt: value.startedAt,
    completedAt: value.completedAt,
    resumeOf: value.resumeOf,
    errorCode: value.errorCode,
    previewDirective: value.previewDirective,
    // A needs_input run's question travels to the surface: a wait the
    // person cannot read is a phantom wait.
    boundaryQuestion: value.boundaryQuestion ?? null,
    completionEventId: value.completionEventId,
    boundaryContract: value.boundaryContract,
    createdAt: value.createdAt,
  };
}

export function listExecutionRuns(db, cardId) {
  return db.prepare("SELECT * FROM execution_runs WHERE card_id = ? ORDER BY created_at DESC").all(cardId).map(row);
}

export function activeExecutionRun(db, cardId) {
  return row(db.prepare("SELECT * FROM execution_runs WHERE card_id = ? AND normalized_status IN ('queued','running','needs_input') ORDER BY created_at DESC LIMIT 1").get(cardId));
}

/**
 * The patchable run columns, once.
 *
 * The same ten fields are bound in two updates — a same-state patch and a real
 * transition — and each update has to bind its arguments in exactly the order
 * its SET clause names them. Spelling both out twice is how a column and its
 * argument drift apart and the update starts writing the wrong field, so the
 * names live here and the two SET clauses are derived from them.
 *
 * The two clauses differ in one respect, deliberately: a same-state patch
 * COALESCEs everything (a patch must never clear a field it does not mention),
 * while a transition writes error_code and preview_directive directly, because
 * moving state IS how the previous run's error is cleared.
 */
const PATCHABLE = [
  ["runId", "run_id"],
  ["nativeStatus", "native_status"],
  ["errorCode", "error_code"],
  ["previewDirective", "preview_directive"],
  ["completionEventId", "completion_event_id"],
  ["needsInputSentAt", "needs_input_sent_at"],
  ["resumeRequestedAt", "resume_requested_at"],
  ["boundaryId", "boundary_id"],
  ["boundaryQuestion", "boundary_question"],
  ["boundaryContract", "boundary_contract"],
];

// A same-state patch: every field keeps its value unless the patch names it.
const SAME_STATE_SET = PATCHABLE
  .map(([, column]) => `${column} = COALESCE(?, ${column})`)
  .join(", ");

// A transition: the two direct fields first (a move clears them), then the rest
// keep their value unless the patch names them.
const CLEARED_ON_MOVE = ["errorCode", "previewDirective"];
const TRANSITION_SET = [
  ...CLEARED_ON_MOVE.map((field) => {
    const column = PATCHABLE.find(([name]) => name === field)[1];
    return `${column} = ?`;
  }),
  ...PATCHABLE.filter(([field]) => !CLEARED_ON_MOVE.includes(field))
    .map(([, column]) => `${column} = COALESCE(?, ${column})`),
].join(", ");

const patchArguments = (patch) => PATCHABLE.map(([field]) => {
  const value = patch[field];
  if (value === undefined) return null;
  return field === "boundaryContract" && value !== null ? JSON.stringify(value) : value;
});

export function transitionExecutionRun(db, id, next, patch = {}) {
  const current = getExecutionRun(db, id);
  if (!current) throw new Error(`execution run ${id} not found`);
  if (!STATES.includes(next)) throw new Error(`unknown normalized execution state ${next}`);
  if (current.normalizedStatus === next) {
    // A same-state transition is only worth a write when the patch carries new
    // evidence: the native run moves (run id, needs-input, the boundary
    // contract) long after the normalized state settled.
    if (patchArguments(patch).some((value) => value !== null)) {
      db.prepare(`UPDATE execution_runs SET ${SAME_STATE_SET} WHERE id = ?`)
        .run(...patchArguments(patch), id);
      return getExecutionRun(db, id);
    }
    return current;
  }
  if (!TRANSITIONS[current.normalizedStatus].has(next)) throw new Error(`invalid execution transition ${current.normalizedStatus} -> ${next}`);
  const completedAt = ["succeeded", "failed", "cancelled"].includes(next) ? (patch.completedAt ?? Date.now()) : null;
  const cleared = CLEARED_ON_MOVE.map((field) => patch[field] ?? null);
  db.prepare(
    "UPDATE execution_runs SET run_id = COALESCE(?, run_id), native_status = COALESCE(?, native_status), "
    + `normalized_status = ?, completed_at = ?, ${TRANSITION_SET} WHERE id = ?`,
  )
    .run(
      patch.runId ?? null,
      patch.nativeStatus ?? null,
      next,
      completedAt,
      ...cleared,
      ...patchArguments(patch).filter((_, index) => !CLEARED_ON_MOVE.includes(PATCHABLE[index][0])),
      id,
    );
  return getExecutionRun(db, id);
}

export function recordExecutionCompletion(db, id, eventId, status, patch = {}) {
  if (!eventId) throw new Error("execution completion event id is required");
  const existing = db.prepare("SELECT id FROM execution_runs WHERE completion_event_id = ?").get(eventId);
  if (existing) return { run: getExecutionRun(db, existing.id), duplicate: true };
  return { run: transitionExecutionRun(db, id, status, { ...patch, completionEventId: eventId }), duplicate: false };
}

export function markExecutionNeedsInputSent(db, id, at = Date.now()) {
  db.prepare("UPDATE execution_runs SET needs_input_sent_at = ? WHERE id = ?").run(at, id);
  return getExecutionRun(db, id);
}

export function markExecutionResumeRequested(db, id, at = Date.now()) {
  db.prepare("UPDATE execution_runs SET resume_requested_at = ? WHERE id = ?").run(at, id);
  return getExecutionRun(db, id);
}

export function resumeArtifactRoot(artifactRoot) {
  return artifactRoot;
}

export function resetExecutionBoundary(db, id) {
  db.prepare("UPDATE execution_runs SET needs_input_sent_at = NULL, resume_requested_at = NULL WHERE id = ?").run(id);
  return getExecutionRun(db, id);
}

export function cancelExecutionRuns(db, cardId, reason = "card-terminal") {
  const active = db.prepare("SELECT id FROM execution_runs WHERE card_id = ? AND normalized_status IN ('queued','running','needs_input')").all(cardId);
  for (const entry of active) transitionExecutionRun(db, entry.id, "cancelled", { errorCode: reason });
  return active.length;
}

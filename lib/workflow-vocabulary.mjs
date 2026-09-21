/**
 * The vocabulary and ordered checkpoints of the Build workflow.
 *
 * A workflow is the full delivery path, phases are board-level groupings, and
 * stages are its ordered checkpoints. Explore intentionally uses a separate
 * technique catalog: a technique is a one-off method, not a workflow stage.
 */
export const WORKFLOW_PHASES = [
  { id: "analysis", label: "Analysis" },
  { id: "planning", label: "Planning" },
  { id: "execution", label: "Execution" },
  { id: "review", label: "Review" },
];

/**
 * Upstream methodology: every stage links to the Stelow skill that owns it.
 * Skill-root URLs only (never deep file links): stage docs move, skill dirs
 * are the stable address. One base + one skill id per stage, so a repo
 * rename is a one-line change and per-stage URLs cannot drift.
 */
export const STELOW_UPSTREAM_BASE = "https://github.com/calionauta/stelow/tree/main/skills";
export const STELOW_UPSTREAM_BLOB = "https://github.com/calionauta/stelow/blob/main/skills";

export const WORKFLOW_STAGES = [
  { id: "triage", label: "Triage", phase: "analysis", skill: "stelow-workflow-orchestrator", doc: "stages/triage.md", produces: "Reviews the current state and picks what to work on next." },
  { id: "select", label: "Choose work", phase: "analysis", skill: "stelow-workflow-orchestrator", doc: null, produces: "Chooses an item or group from the triage inbox to turn into a workflow." },
  { id: "setup", label: "Setup", phase: "analysis", skill: "stelow-workflow-orchestrator", doc: "stages/setup.md", produces: "Prepares the repo and environment the workflow will run in." },
  { id: "context", label: "Context", phase: "analysis", skill: "stelow-workflow-orchestrator", doc: "stages/context.md", produces: "Gathers project context the shaping step needs." },
  { id: "shape", label: "Shape proposal", phase: "analysis", skill: "stelow-workflow-shape-up", doc: null, produces: "Writes a Shape Up proposal (spec-product_vN.md) for the chosen item." },
  { id: "critique", label: "Critique", phase: "planning", skill: "stelow-workflow-plan-critique", doc: null, produces: "Challenges the proposal before it is gated." },
  { id: "gate", label: "Product gate", phase: "planning", skill: "stelow-workflow-orchestrator", doc: "stages/gate.md", produces: "Product gate: decides whether the shaped idea is accepted, rejected, or reworked." },
  { id: "scope", label: "Scope", phase: "planning", skill: "stelow-workflow-orchestrator", doc: null, produces: "Breaks the approved idea into a concrete scope of work." },
  { id: "interface", label: "Interface", phase: "planning", skill: "stelow-workflow-interface-alternatives", doc: null, produces: "Designs the user-facing interface for the scope." },
  { id: "int-gate", label: "Interface gate", phase: "planning", skill: "stelow-workflow-interface-alternatives", doc: null, produces: "Interface gate: accepts, rejects, or reworks the interface design." },
  { id: "selection", label: "Interface selection", phase: "planning", skill: "stelow-workflow-orchestrator", doc: "stages/selection.md", produces: "Selects which interface variant to implement." },
  { id: "planning", label: "Tech planning", phase: "planning", skill: "stelow-workflow-tech-planning", doc: null, produces: "Writes the technical plan (PLAN.md) from the interface and scope." },
  { id: "plan-gate", label: "Plan gate", phase: "planning", skill: "stelow-workflow-orchestrator", doc: "stages/plan-gate.md", produces: "Plan gate: accepts, rejects, or reworks the tech plan." },
  { id: "execution", label: "Execution", phase: "execution", skill: "stelow-workflow-scope-executor", doc: null, produces: "Implements the plan across the defined scope." },
  { id: "verification", label: "Verification", phase: "execution", skill: "stelow-workflow-testing-execution", doc: null, produces: "Verifies the implementation against the plan." },
  { id: "diff-gate", label: "Diff gate", phase: "review", skill: "stelow-workflow-orchestrator", doc: "stages/diff-gate.md", produces: "Diff gate: checks the implementation diff before completion." },
  { id: "audit", label: "Audit", phase: "review", skill: "stelow-workflow-execution-critique", doc: null, produces: "Final audit of the finished work." },
];

export const STAGE_SEQUENCE = WORKFLOW_STAGES.map(({ id }) => id);
export const STAGE_LABELS = Object.fromEntries(WORKFLOW_STAGES.map(({ id, label }) => [id, label]));
export const STAGE_PRODUCES = Object.fromEntries(WORKFLOW_STAGES.map(({ id, produces }) => [id, produces]));
export const STAGE_SKILL = Object.fromEntries(WORKFLOW_STAGES.map(({ id, skill }) => [id, skill]));
export const STAGE_DOC = Object.fromEntries(WORKFLOW_STAGES.map(({ id, doc }) => [id, doc]));
export const PHASE_LABELS = Object.fromEntries(WORKFLOW_PHASES.map(({ id, label }) => [id, label]));

// The Build board is a projection of the workflow, not another workflow
// definition. Keep its phase columns derived from WORKFLOW_PHASES and name
// its two terminal outcomes here so the UI, RPC validation, and move policy
// cannot independently invent or reorder columns.
//
// Inbox precedes the phases on every track: it is where a card sits when it
// has been captured but has nothing running yet (creation can defer the
// worker). Entering a phase is what starts the card.
//
// The column reads "Bucket" everywhere users see it — one word for the
// pile of captured, not-yet-running work. The stored key stays "inbox"
// (statuses, RPCs, and move targets reference it); only the label changed,
// so no migration exists. Every user-facing reference to the column must
// use the label from these maps, never a pasted string.
export const BUILD_BOARD_INBOX = "inbox";
export const BUILD_BOARD_TERMINALS = ["completed", "archived"];
export const BUILD_BOARD_COLUMNS = [BUILD_BOARD_INBOX, ...WORKFLOW_PHASES.map(({ id }) => id), ...BUILD_BOARD_TERMINALS];
// Rendered boards hide the Bucket: its header button + gallery modal are
// the surface now, so the column would duplicate them. Grouping, moves,
// and filters keep the full catalog — only rendering filters it out.
export const BUILD_BOARD_VISIBLE_COLUMNS = BUILD_BOARD_COLUMNS.filter((column) => column !== BUILD_BOARD_INBOX);
export const BUILD_BOARD_COLUMN_LABELS = {
  [BUILD_BOARD_INBOX]: "Bucket",
  ...PHASE_LABELS,
  completed: "Done",
  archived: "Archived",
};

// A manual move into a Build phase enters its first meaningful checkpoint.
// This is deliberately adjacent to the phase and stage catalog rather than
// hidden in the RPC handler, where the two can drift.
export const PHASE_ENTRY_STAGES = {
  analysis: "triage",
  planning: "critique",
  execution: "execution",
  review: "diff-gate",
};
export const STAGE_BANDS = {
  ...Object.fromEntries(WORKFLOW_PHASES.map(({ id }) => [id, WORKFLOW_STAGES.filter((stage) => stage.phase === id).map((stage) => stage.id)])),
  research: ["research"],
  explore: ["explore"],
};
export const STAGE_TO_BAND = Object.fromEntries(Object.entries(STAGE_BANDS).flatMap(([band, stages]) => stages.map((stage) => [stage, band])));

/**
 * One Build-card projection for every board consumer. A completed or archived
 * card is terminal regardless of the last checkpoint retained for its audit
 * trail; a captured-but-unstarted card sits in the Bucket because it has no
 * phase yet; otherwise the current checkpoint determines the phase column.
 *
 * The Bucket test is strictly `workerThreadId === null`: the field is part of
 * the card contract (null means "no thread"), so an *absent* field is a caller
 * that did not report thread state — never a reason to call a card unstarted.
 */
export function buildBoardColumnFor(card) {
  if (BUILD_BOARD_TERMINALS.includes(card.status)) return card.status;
  if (card.status === "draft" && card.workerThreadId === null) return BUILD_BOARD_INBOX;
  return STAGE_TO_BAND[card.stage] ?? "analysis";
}

export function stageLabel(stage) {
  return STAGE_LABELS[stage] ?? (stage === "research" ? "Research" : stage === "explore" ? "Explore" : stage);
}

/** Upstream skill dir that owns a stage (orchestrator for inline stages). */
export function stageSkill(stage) {
  return STAGE_SKILL[stage] ?? null;
}

/** Stable GitHub URL for a stage's owning skill. Null for unknown stages. */
export function stageSkillUrl(stage) {
  const skill = STAGE_SKILL[stage];
  return skill ? `${STELOW_UPSTREAM_BASE}/${skill}` : null;
}

/**
 * Most precise stable URL for a stage: its dedicated behavior doc when the
 * upstream skill ships one (orchestrator `stages/*.md`), otherwise the owning
 * skill root (dedicated skills ARE the stage doc). Null for unknown stages.
 */
export function stageInfoUrl(stage) {
  const entry = WORKFLOW_STAGES.find(({ id }) => id === stage);
  if (!entry) return null;
  return entry.doc ? `${STELOW_UPSTREAM_BLOB}/${entry.skill}/${entry.doc}` : stageSkillUrl(stage);
}

/**
 * The vocabulary and ordered checkpoints of the Build workflow.
 *
 * A workflow is the full delivery path, phases are board-level groupings, and
 * stages are its ordered checkpoints. Explore intentionally uses a separate
 * technique catalog: a technique is a one-off method, not a workflow stage.
 */
export const WORKFLOW_PHASES = [
  { id: "analysis", label: "Analyze" },
  { id: "planning", label: "Plan" },
  { id: "execution", label: "Execute" },
  { id: "review", label: "Review" },
];

/**
 * Upstream methodology: every stage links to the Stelow skill that owns it.
 * Skill-root URLs only (never deep file links): stage docs move, skill dirs
 * are the stable address. One base + one skill id per stage, so a repo
 * rename is a one-line change and per-stage URLs cannot drift.
 */
export const STELOW_UPSTREAM_BASE = "https://github.com/calionauta/stelow/tree/main/skills";

export const WORKFLOW_STAGES = [
  { id: "triage", label: "Triage", phase: "analysis", skill: "stelow-workflow-orchestrator", produces: "Reviews the current state and picks what to work on next." },
  { id: "select", label: "Choose work", phase: "analysis", skill: "stelow-workflow-orchestrator", produces: "Chooses an item or group from the triage inbox to turn into a workflow." },
  { id: "setup", label: "Setup", phase: "analysis", skill: "stelow-workflow-orchestrator", produces: "Prepares the repo and environment the workflow will run in." },
  { id: "context", label: "Context", phase: "analysis", skill: "stelow-workflow-orchestrator", produces: "Gathers project context the shaping step needs." },
  { id: "shape", label: "Shape proposal", phase: "analysis", skill: "stelow-workflow-shape-up", produces: "Writes a Shape Up proposal (spec-product_vN.md) for the chosen item." },
  { id: "critique", label: "Critique", phase: "planning", skill: "stelow-workflow-plan-critique", produces: "Challenges the proposal before it is gated." },
  { id: "gate", label: "Product gate", phase: "planning", skill: "stelow-workflow-orchestrator", produces: "Product gate: decides whether the shaped idea is accepted, rejected, or reworked." },
  { id: "scope", label: "Scope", phase: "planning", skill: "stelow-workflow-orchestrator", produces: "Breaks the approved idea into a concrete scope of work." },
  { id: "interface", label: "Interface", phase: "planning", skill: "stelow-workflow-interface-alternatives", produces: "Designs the user-facing interface for the scope." },
  { id: "int-gate", label: "Interface gate", phase: "planning", skill: "stelow-workflow-interface-alternatives", produces: "Interface gate: accepts, rejects, or reworks the interface design." },
  { id: "selection", label: "Interface selection", phase: "planning", skill: "stelow-workflow-orchestrator", produces: "Selects which interface variant to implement." },
  { id: "planning", label: "Tech planning", phase: "planning", skill: "stelow-workflow-tech-planning", produces: "Writes the technical plan (PLAN.md) from the interface and scope." },
  { id: "plan-gate", label: "Plan gate", phase: "planning", skill: "stelow-workflow-orchestrator", produces: "Plan gate: accepts, rejects, or reworks the tech plan." },
  { id: "execution", label: "Execution", phase: "execution", skill: "stelow-workflow-scope-executor", produces: "Implements the plan across the defined scope." },
  { id: "verification", label: "Verification", phase: "execution", skill: "stelow-workflow-testing-execution", produces: "Verifies the implementation against the plan." },
  { id: "diff-gate", label: "Diff gate", phase: "review", skill: "stelow-workflow-orchestrator", produces: "Diff gate: checks the implementation diff before completion." },
  { id: "audit", label: "Audit", phase: "review", skill: "stelow-workflow-execution-critique", produces: "Final audit of the finished work." },
];

export const STAGE_SEQUENCE = WORKFLOW_STAGES.map(({ id }) => id);
export const STAGE_LABELS = Object.fromEntries(WORKFLOW_STAGES.map(({ id, label }) => [id, label]));
export const STAGE_PRODUCES = Object.fromEntries(WORKFLOW_STAGES.map(({ id, produces }) => [id, produces]));
export const STAGE_SKILL = Object.fromEntries(WORKFLOW_STAGES.map(({ id, skill }) => [id, skill]));
export const PHASE_LABELS = Object.fromEntries(WORKFLOW_PHASES.map(({ id, label }) => [id, label]));

// The Build board is a projection of the workflow, not another workflow
// definition. Keep its phase columns derived from WORKFLOW_PHASES and name
// its two terminal outcomes here so the UI, RPC validation, and move policy
// cannot independently invent or reorder columns.
export const BUILD_BOARD_TERMINALS = ["completed", "archived"];
export const BUILD_BOARD_COLUMNS = [...WORKFLOW_PHASES.map(({ id }) => id), ...BUILD_BOARD_TERMINALS];
export const BUILD_BOARD_COLUMN_LABELS = {
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
 * trail; otherwise the current checkpoint determines the phase column.
 */
export function buildBoardColumnFor(card) {
  if (BUILD_BOARD_TERMINALS.includes(card.status)) return card.status;
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

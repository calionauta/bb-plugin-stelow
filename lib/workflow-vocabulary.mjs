import {
  PHASE_LABELS,
  PHASE_ENTRY_STAGES,
  STAGE_BY_ID,
  STAGE_DOC,
  STAGE_LABELS,
  STAGE_PRODUCES,
  STAGE_SEQUENCE,
  STAGE_SKILL,
  WORKFLOW_PHASES,
  WORKFLOW_STAGES,
} from "./workflow-catalog.mjs";

export {
  PHASE_LABELS,
  PHASE_ENTRY_STAGES,
  STAGE_BY_ID,
  STAGE_DOC,
  STAGE_LABELS,
  STAGE_PRODUCES,
  STAGE_SEQUENCE,
  STAGE_SKILL,
  WORKFLOW_PHASES,
  WORKFLOW_STAGES,
};

/**
 * Upstream methodology: every stage links to the Stelow skill that owns it.
 * Skill-root URLs only (never deep file links): stage docs move, skill dirs
 * are the stable address. One base + one skill id per stage, so a repo
 * rename is a one-line change and per-stage URLs cannot drift.
 */
export const STELOW_UPSTREAM_BASE = "https://github.com/calionauta/stelow/tree/main/skills";
export const STELOW_UPSTREAM_BLOB = "https://github.com/calionauta/stelow/blob/main/skills";

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
  return entry.doc ? `${STELOW_UPSTREAM_BLOB}/${entry.docSkill ?? entry.skill}/${entry.doc}` : stageSkillUrl(stage);
}

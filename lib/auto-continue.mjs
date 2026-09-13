// Bounded auto-continue for build workers that stop mid-workflow.
// Background: the provider ends a turn whenever the model emits a final
// text message, so a worker that narrates progress ("Stage done, moving
// on") idles after every stage even with work remaining. The plugin used
// to only surface that as a paused inbox event and wait for a human
// Resume. This module decides when the host may resume the worker itself:
// exactly one nudge per fresh idle edge, only when the finished turn left
// new output or stage progress behind, never past a pending question or a
// terminal stage, and never more than MAX_AUTO_CONTINUES consecutive
// nudges without a stage advance (a worker that keeps yielding without
// advancing is stuck, not chatty — it needs the human, not another turn).

export const MAX_AUTO_CONTINUES = 10;

export const TERMINAL_STAGES = ["audit"];

export function ensureAutoContinueColumns(db) {
  const columns = db.prepare("PRAGMA table_info(cards)").all();
  if (!columns.some((column) => column.name === "auto_continue_count")) {
    db.exec("ALTER TABLE cards ADD COLUMN auto_continue_count INTEGER NOT NULL DEFAULT 0");
  }
  if (!columns.some((column) => column.name === "auto_continue_stage")) {
    db.exec("ALTER TABLE cards ADD COLUMN auto_continue_stage TEXT");
  }
}

export function shouldAutoContinue({ status, stage, questionPending, transitioningIntoIdle, progressed, autoCount, autoStage }) {
  if (status !== "idle") return { proceed: false, reason: "thread is not idle" };
  if (questionPending) return { proceed: false, reason: "a question is pending an answer" };
  if (TERMINAL_STAGES.includes(stage)) return { proceed: false, reason: "workflow reached its terminal stage" };
  if (!transitioningIntoIdle) return { proceed: false, reason: "not a fresh idle edge" };
  if (!progressed) return { proceed: false, reason: "the finished turn left no new output or stage progress" };
  // The budget counts consecutive nudges without a stage advance: advancing
  // resets it, so long stages earn more turns while a stuck worker stops.
  const effectiveCount = stage === autoStage ? (autoCount ?? 0) : 0;
  if (effectiveCount >= MAX_AUTO_CONTINUES) return { proceed: false, reason: "auto-continue budget exhausted" };
  return { proceed: true, reason: "idle worker with unfinished work and fresh progress" };
}

export function nextAutoContinue({ stage, autoCount, autoStage }) {
  const count = stage === autoStage ? (autoCount ?? 0) + 1 : 1;
  return { count, stage };
}

export function resetAutoContinue() {
  return { count: 0, stage: null };
}

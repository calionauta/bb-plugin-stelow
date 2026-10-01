// A card whose work is running inside a host Workflows run, read as a fact.
//
// The card's thread going idle does NOT mean the card stopped. A native run is
// a `bb workflows run` subprocess that outlives the turn that started it: on
// card_cbnihg4c (2026-09-30) the `planning-research` run started at 19:42 and
// was still `running` ten minutes later while the coordinator thread sat idle.
//
// The plugin had a rule for exactly this — `keepsCardRunning`, written in
// `server/execution-lifecycle-start.ts` and never called by anything. So the
// sync loop read the idle thread, found no pending question, and took the idle
// branch: it nudged the worker, spent auto-continue budget on turns that had
// nothing to do with the run, and finally parked the card as "Idle with
// unfinished work" behind a Resume button. A human pressing that button would
// have restarted a card that was mid-workflow. The rule existed; it was simply
// not connected to the only place that needed it.
//
// So the rule lives here, in the same shape as `lib/host-hold.mjs`: the record
// is the truth, and every sentence is DERIVED from it, every time. A writer
// cannot hold a card and render a different reason, because it only has one
// value to pass.
//
// The one-line contract, shared with the hold: work the system is already
// doing gets no button and no inbox row. What a person can move gets both.

/** Activity value while a host run owns the card's stage. */
export const RUN_ACTIVITY = "running";

/** The states in which a run still owns the card. Mirrors the ledger's own. */
const LIVE_STATES = new Set(["queued", "running", "needs_input"]);

/**
 * The run that keeps this card alive, or null.
 *
 * A run waiting on a boundary (`needs_input`) only counts while nothing else
 * is asking the user something: a card with an open question is a card the
 * user is already in, and the question is the thing to show. That nuance is
 * the caller's to supply, because only the caller knows the open question
 * count — see `keepsCardRunning`.
 */
export function liveRun(runs) {
  const live = (Array.isArray(runs) ? runs : []).filter(
    (run) => run && LIVE_STATES.has(run.normalizedStatus),
  );
  return live[0] ?? null;
}

/**
 * Whether a live run means the card must keep running, given what the user is
 * already being asked.
 *
 * This is the rule that was written and never wired. It is a function of two
 * facts and neither is derivable from the other: the run's state, and whether a
 * question is open. `needs_input` with an open question is a card waiting for
 * a person; `needs_input` without one is a card whose run is still working.
 */
export function keepsCardRunning(runs, openQuestionCount) {
  const run = liveRun(runs);
  if (!run) return false;
  if (["queued", "running"].includes(run.normalizedStatus)) return true;
  return run.normalizedStatus === "needs_input" && openQuestionCount === 0;
}

/**
 * The sentence, derived from the record.
 *
 * Every derivation ends in the promise that makes it safe to show: the run
 * finishes on its own, and the reader is not the one who has to. A sentence
 * that implied work — "resume", "retry", "check the run" — would put a human
 * between a workflow that is already progressing.
 */
export function runSentence(run) {
  if (!run) return null;
  const what = runLabel(run);
  if (run.normalizedStatus === "needs_input") {
    return `The ${what} run is waiting on a decision before it continues. `
      + "Answer it on the card and the run picks up on its own — no action needed otherwise.";
  }
  if (run.normalizedStatus === "queued") {
    return `The ${what} run is queued on the host and starts as soon as it can. `
      + "The card continues on its own — no action needed.";
  }
  return `The ${what} run is working now; the card's thread is idle while it does. `
    + "The card continues on its own — no action needed.";
}

/**
 * What the run is called, in the reader's vocabulary.
 *
 * The recipe id is the host's slug (`planning-research`) and the stage is the
 * card's own (`Tech planning`). Showing both is what made the run list read as
 * noise: the card said "Tech planning" and the run said "planning-research",
 * and a reader could not tell they were the same stage. The stage label is
 * preferred because it is the word the rest of the card already uses; the
 * recipe is the fallback for a run whose stage the catalog does not name.
 */
function runLabel(run) {
  if (typeof run.stageLabel === "string" && run.stageLabel.trim()) return run.stageLabel.trim();
  if (typeof run.stage === "string" && run.stage.trim()) return run.stage.trim();
  if (typeof run.recipeId === "string" && run.recipeId.trim()) return run.recipeId.trim();
  return "workflow";
}

/**
 * Update fields for "a host run owns this card".
 *
 * Activity and text only — never `status`, so the card stays in its column,
 * for the same reason `holdUpdates` does not move it: board position is durable
 * progress and a run in flight is not progress. The idle timestamp is cleared
 * because a card that is not idle has no "idle since" to show.
 */
export function runUpdates(lastOutput) {
  return {
    activity: RUN_ACTIVITY,
    last_assistant_text: lastOutput,
    last_idle_at: null,
  };
}

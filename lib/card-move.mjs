/**
 * Board-move decisions for build vs lightweight (research / explore) cards.
 * Pure so the cross-refusal contract (each track refuses the other's columns
 * with a named exit) is pinned by a unit test instead of living inline in
 * the RPC handler, where a regression would silently misfile cards.
 *
 * Returns { ok: true, move: { type: "status", status } } to set a status,
 * { ok: true, move: { type: "phase", phase } } to enter a build phase
 * (the handler maps phases to entry stages), or { ok: false, error }
 * naming the valid exit. Unknown targets refuse on both tracks.
 *
 * `hasWorker` is the card's live thread state, and it is only consulted for
 * the Bucket: parking a card that is already running would orphan its worker, so
 * that one move refuses with a named exit.
 *
 * `stage` + `stagePhases` are the card's real position, and they exist because
 * without them this function CANNOT see where the card is: every phase was
 * reachable from every stage, so a card in `triage` could be dropped on `review`
 * and the handler would write the review entry stage and spawn a worker there,
 * skipping shape, critique, planning and every gate. Nothing downstream caught
 * it — the gates check the artifact they are ABOUT (forward-looking), never the
 * path the card took to get there. The skip was silent, permanent, and spent a
 * worker turn. Every stage belongs to exactly one phase, so the position is
 * always answerable; a card whose stage is unknown still moves, because a guard
 * that silently unlocks on missing data is not a guard.
 */

import { BUILD_BOARD_INBOX, BUILD_BOARD_TERMINALS, WORKFLOW_PHASES } from "./workflow-vocabulary.mjs";
import { LIGHTWEIGHT_COLUMNS, LIGHTWEIGHT_STATUS_BY_COLUMN, isLightweightKind, normalizeKind } from "./tracks.mjs";

const BUILD_PHASES = WORKFLOW_PHASES.map(({ id }) => id);

/**
 * A phase target is a claim that the work of the current phase is finished. The
 * honest ones are "the next phase" and "this is done, park it". A skip is a
 * claim about work nobody did, and a rewind throws away work that was done —
 * so both refuse, and both name the way forward.
 */
function phaseOrderRefusal(currentPhase, target, stage, entryStages) {
  const at = BUILD_PHASES.indexOf(currentPhase);
  const to = BUILD_PHASES.indexOf(target);
  if (at < 0 || to < 0) return null;
  if (to === at) {
    const entry = entryStages[target];
    // Sitting ON the phase's entry stage and dropped on its own column changes
    // nothing, so it must not become an error. The most common drag in this UI
    // is nudging a card a few pixels and letting go where it already sat, and
    // answering "already in planning" for a move with no effect teaches people
    // the guard is noise. The handler's same-column check turns this into a
    // silent no-op; deeper stages in the same phase still refuse below.
    if (entry && entry === stage) return null;
    // Name the stage it would land on. "It would reset" is a cost in the
    // abstract; "it would go back to critique" is a cost the reader can weigh
    // against the work they remember doing.
    return [
      `This card is already in ${target} (at ${stage}).`,
      entry
        ? `Re-entering the phase would reset it to ${entry}`
        : "Re-entering the phase would reset it to the phase's entry stage",
      "— restart it instead if that is what you want.",
    ].join(" ");
  }
  if (to < at) {
    return [
      `${target} is behind where this card is (at ${stage}).`,
      "A drag cannot rewind a workflow, and going back discards the stages",
      "in between — restart the card if that is what you want.",
    ].join(" ");
  }
  if (to > at + 1) {
    return [
      `${target} is more than one phase ahead of this card (at ${stage}).`,
      `The phases in between produce the artifacts ${target} is supposed to`,
      "review. Move it one phase at a time, or let the worker advance it.",
    ].join(" ");
  }
  return null;
}

export function resolveCardMove(
  kind,
  target,
  { hasWorker = false, stage, stagePhases = {}, phaseEntryStages = {} } = {},
) {
  // Research and Explore cards share the lightweight Bucket / Doing / Done /
  // Archived lifecycle: no build phases, no stage machine.
  if (isLightweightKind(kind)) {
    const next = LIGHTWEIGHT_STATUS_BY_COLUMN[target];
    if (!next) return { ok: false, error: "Research and Explore cards move between Bucket, Doing, Done, and Archived — build phases do not apply." };
    return { ok: true, move: { type: "status", status: next } };
  }
  if (normalizeKind(kind) !== "build") {
    return { ok: false, error: "Unknown board column." };
  }
  if (BUILD_PHASES.includes(target)) {
    const currentPhase = stage ? stagePhases[stage] : undefined;
    const refusal = currentPhase
      ? phaseOrderRefusal(currentPhase, target, stage, phaseEntryStages)
      : null;
    if (refusal) return { ok: false, error: refusal };
    return { ok: true, move: { type: "phase", phase: target } };
  }
  if (target === BUILD_BOARD_INBOX) {
    if (hasWorker) {
      return { ok: false, error: "This card already has a worker — the Bucket is for cards that have not started. Move it to a workflow phase, or archive it." };
    }
    return { ok: true, move: { type: "status", status: "draft" } };
  }
  if (LIGHTWEIGHT_COLUMNS.includes(target) && !BUILD_BOARD_TERMINALS.includes(target)) {
    return { ok: false, error: "Build cards move between the Bucket and workflow phases — Doing and Done are lightweight columns." };
  }
  if (target === "completed") {
    return { ok: false, error: "Build cards become Done only when the worker runs `bb stelow done` after audit verification. Move it to the Review phase to continue or archive it." };
  }
  if (BUILD_BOARD_TERMINALS.includes(target)) {
    return { ok: true, move: { type: "status", status: target } };
  }
  return { ok: false, error: "Unknown board column." };
}

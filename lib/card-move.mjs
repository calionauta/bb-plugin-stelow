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
 */

import { BUILD_BOARD_INBOX, BUILD_BOARD_TERMINALS, WORKFLOW_PHASES } from "./workflow-vocabulary.mjs";
import { LIGHTWEIGHT_COLUMNS, LIGHTWEIGHT_STATUS_BY_COLUMN, isLightweightKind, normalizeKind } from "./tracks.mjs";

const BUILD_PHASES = WORKFLOW_PHASES.map(({ id }) => id);

export function resolveCardMove(kind, target, { hasWorker = false } = {}) {
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

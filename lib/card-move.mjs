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
 */

import { isLightweightKind, normalizeKind } from "./tracks.mjs";

const LIGHTWEIGHT_STATUS = {
  todo: "pending",
  doing: "in-progress",
  done: "completed",
  archived: "archived",
};

const BUILD_PHASES = ["analysis", "planning", "execution", "review"];
const BUILD_TERMINALS = ["completed", "archived"];
const LIGHTWEIGHT_COLUMNS = ["todo", "doing", "done"];

export function resolveCardMove(kind, target) {
  // Research and Explore cards share the lightweight To-Do / Doing / Done /
  // Archived lifecycle: no build phases, no stage machine.
  if (isLightweightKind(kind)) {
    const next = LIGHTWEIGHT_STATUS[target];
    if (!next) return { ok: false, error: "Research and Explore cards move between To-Do, Doing, Done, and Archived — build phases do not apply." };
    return { ok: true, move: { type: "status", status: next } };
  }
  if (normalizeKind(kind) !== "build") {
    return { ok: false, error: "Unknown board column." };
  }
  if (LIGHTWEIGHT_COLUMNS.includes(target)) {
    return { ok: false, error: "Build cards move between workflow phases — To-Do / Doing / Done are lightweight columns." };
  }
  if (BUILD_PHASES.includes(target)) {
    return { ok: true, move: { type: "phase", phase: target } };
  }
  if (BUILD_TERMINALS.includes(target)) {
    return { ok: true, move: { type: "status", status: target } };
  }
  return { ok: false, error: "Unknown board column." };
}

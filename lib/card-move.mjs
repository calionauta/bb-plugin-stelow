/**
 * Board-move decisions for delivery vs research cards. Pure so the
 * cross-refusal contract (each track refuses the other's columns with a
 * named exit) is pinned by a unit test instead of living inline in the
 * RPC handler, where a regression would silently misfile cards.
 *
 * Returns { ok: true, move: { type: "status", status } } to set a status,
 * { ok: true, move: { type: "phase", phase } } to enter a delivery phase
 * (the handler maps phases to entry stages), or { ok: false, error }
 * naming the valid exit. Unknown targets refuse on both tracks.
 */

const RESEARCH_STATUS = {
  todo: "pending",
  doing: "in-progress",
  done: "completed",
  archived: "archived",
};

const DELIVERY_PHASES = ["analysis", "planning", "execution", "review"];
const DELIVERY_TERMINALS = ["completed", "archived"];
const RESEARCH_COLUMNS = ["todo", "doing", "done"];

export function resolveCardMove(kind, target) {
  if (kind === "research") {
    const next = RESEARCH_STATUS[target];
    if (!next) return { ok: false, error: "Research cards move between To-Do, Doing, Done, and Archived — delivery phases do not apply." };
    return { ok: true, move: { type: "status", status: next } };
  }
  if (RESEARCH_COLUMNS.includes(target)) {
    return { ok: false, error: "Delivery cards move between workflow phases — To-Do / Doing / Done are research columns." };
  }
  if (DELIVERY_PHASES.includes(target)) {
    return { ok: true, move: { type: "phase", phase: target } };
  }
  if (DELIVERY_TERMINALS.includes(target)) {
    return { ok: true, move: { type: "status", status: target } };
  }
  return { ok: false, error: "Unknown board column." };
}

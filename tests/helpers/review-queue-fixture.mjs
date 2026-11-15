/**
 * The review queue's test fixtures, shared by the two files that drive it.
 *
 * `review-queue-rail.test.mjs` is about what reaches the screen (the reading, the
 * legend, the row anatomy, the failure and checking states); `review-queue-keys.
 * test.mjs` is about what the keyboard does (arrows, Escape, `q`, where focus
 * lands). Both need the same four cards, the same ledger and the same stub rpc,
 * so they live here rather than being copied into each file.
 */
import { cleanup } from "@testing-library/react";
import { REVIEW_QUEUE_GATES } from "../../lib/review-queue.mjs";

export const DAY = 86_400_000;
// Fixtures hang off the real clock, because the cells are read against it: an
// absolute date would make these files say "81d" a couple of months from now.
export const T = Date.now();
export const [PRODUCT_GATE, DESIGN_GATE, TECH_GATE, CODE_GATE] = REVIEW_QUEUE_GATES.map(
  (gate) => gate.id,
);

export function card(id, stage, overrides = {}) {
  return {
    id,
    displayName: `Card ${id}`,
    name: id,
    stage,
    activity: "idle",
    updatedAt: T,
    ...overrides,
  };
}

export function readEvent(cardId, kind, occurredAt, overrides = {}) {
  return { cardId, kind, occurredAt, readAt: null, resolvedAt: null, archivedAt: null, ...overrides };
}

/** A stub rpc that records every call, so "one read" is assertable. */
export function stubRpc(notifications, options = {}) {
  const calls = [];
  const rpc = {
    calls,
    call: async (name, input) => {
      calls.push({ name, input });
      if (options.fail && options.fail()) throw new Error("ledger unavailable");
      return { notifications };
    },
  };
  return rpc;
}

/**
 * Unmount and forget the stored preference.
 *
 * Whether the rail is open is persisted — it is a reading surface's preference,
 * like a collapsed column — so a block that leaves it open leaves the NEXT block
 * open too. Resetting is what makes each block start from the board's default
 * rather than from the previous block's last click.
 */
export function reset() {
  cleanup();
  window.localStorage.clear();
}

export const openCards = [
  card("old_card", PRODUCT_GATE, { updatedAt: T - 6 * DAY }),
  card("stalled_card", TECH_GATE, { updatedAt: T - 3 * DAY }),
  card("read_card", DESIGN_GATE, { updatedAt: T - 2 * DAY }),
  card("new_card", CODE_GATE, { updatedAt: T - 1 }),
];

export const openLedger = [
  // An open review request dates the wait exactly.
  readEvent("old_card", "completed", T - 6 * DAY),
  // A stall the worker already recovered from: there is no gate entry in the
  // data, so this row keeps a bound instead of a number.
  readEvent("stalled_card", "error", T - 3 * DAY, { resolvedAt: T - 2 * DAY }),
  // Read but not resolved: still the reader's turn, still dated from the stage
  // finishing rather than from somebody glancing at it.
  readEvent("read_card", "completed", T - 2 * DAY, { readAt: T - 2 * DAY + 1 }),
];

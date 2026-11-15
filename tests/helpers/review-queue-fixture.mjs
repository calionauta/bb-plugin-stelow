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
    // The gate clock, as `listCards` now carries it. Defaults to the fixture's
    // "now" so a row without an explicit entry reads `0m` rather than a dash.
    stageEnteredAt: T,
    createdAt: T - 30 * DAY,
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

/**
 * Four gate cards, every one of them waiting on the reader.
 *
 * The ages come off `stageEnteredAt` — six days, three, two and one hour — so the
 * reading exercises every unit the cell can print and one row per gate.
 */
export const openCards = [
  card("old_card", PRODUCT_GATE, { updatedAt: T - 6 * DAY, stageEnteredAt: T - 6 * DAY }),
  card("stalled_card", TECH_GATE, { updatedAt: T - 3 * DAY, stageEnteredAt: T - 3 * DAY }),
  card("read_card", DESIGN_GATE, { updatedAt: T - 2 * DAY, stageEnteredAt: T - 2 * DAY }),
  card("new_card", CODE_GATE, { updatedAt: T - 1, stageEnteredAt: T - 3_600_000 }),
];

export const openLedger = [
  // An open review request: a person owes the next move.
  readEvent("old_card", "completed", T - 6 * DAY),
  // A question the reviewer has to answer.
  readEvent("stalled_card", "question", T - 3 * DAY),
  // Read but not resolved: still the reader's turn, and the age is still the
  // gate's entry rather than the moment somebody glanced at the ledger.
  readEvent("read_card", "completed", T - 2 * DAY, { readAt: T - 2 * DAY + 1 }),
  readEvent("new_card", "question", T - 3_600_000),
];

/**
 * The two readings the count cannot carry: a gate card with nobody on it, and a
 * card the ledger never recorded entering.
 *
 * Kept apart from `openCards` so the badge arithmetic in the rest of the suite
 * stays a plain sum, and so this pair can assert what the queue says when a card
 * is *not* the reader's.
 */
export const mixedCards = [
  card("mine", PRODUCT_GATE, { stageEnteredAt: T - 5 * 3_600_000 }),
  card("orphan", CODE_GATE, { stageEnteredAt: T - 9 * DAY }),
  card("no_entry", DESIGN_GATE, { stageEnteredAt: null, createdAt: T - 3 * DAY }),
];

export const mixedLedger = [
  readEvent("mine", "completed", T - 5 * 3_600_000),
  readEvent("no_entry", "completed", T - 3_600_000),
];

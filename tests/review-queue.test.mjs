import assert from "node:assert/strict";
import {
  REVIEW_QUEUE_GATES,
  attributionOf,
  isHumanWait,
  isReviewGate,
  isSystemWait,
  orderQueueRows,
  queueAgeCell,
  reviewGateLabel,
  reviewQueueBadge,
  reviewQueueRows,
} from "../lib/review-queue.mjs";

/**
 * The review queue's answers, asked of the projection rather than the rail.
 *
 * Three things here are the difference between a queue and a sorted list of
 * cards in gate columns:
 *
 *  - the AGE has a source (`entered`, `since_created`, `unknown`) and never a
 *    guess, so a reader can tell a measurement from a bound from a blank;
 *  - the ORDER is oldest-first and survives a tie without falling back to
 *    whatever order the RPC happened to return;
 *  - WHO IS WAITING comes off the inbox ledger, so a card a worker is holding —
 *    or one whose failure a worker owes — is not counted as the reader's turn.
 *
 * The whole file is pure: no DOM, no clock, no database. `nowMs` is an argument
 * everywhere, which is what lets "drive the clock three days" be one line.
 */

const DAY = 86_400_000;
const T = Date.UTC(2026, 8, 1, 12, 0, 0);

/** A card in a gate column, idle, as `listCards` hands it over. */
function card(id, stage = "gate", overrides = {}) {
  return { id, displayName: `Card ${id}`, name: id, stage, activity: "idle", updatedAt: T, ...overrides };
}

function event(cardId, kind, occurredAt, overrides = {}) {
  return { cardId, kind, occurredAt, readAt: null, resolvedAt: null, archivedAt: null, ...overrides };
}

// --- 1. The gates are the catalog's, not a list printed here ---------------
// Named here rather than re-derived from the catalog: a test that re-runs the
// expression the module runs cannot fail, and this list is the contract.
assert.deepEqual(
  REVIEW_QUEUE_GATES.map((gate) => gate.id),
  ["gate", "int-gate", "plan-gate", "diff-gate"],
  "the queue's gates are the four stages that end in a person's decision",
);
assert.deepEqual(
  REVIEW_QUEUE_GATES.map((gate) => gate.label),
  ["Product Review", "Design Review", "Technical Review", "Code Review"],
  "each gate is named in the catalog's words, which is what a failure line quotes back",
);
for (const gate of REVIEW_QUEUE_GATES) {
  assert.equal(isReviewGate(gate.id), true, `${gate.id} is a gate stage`);
}
assert.equal(reviewGateLabel("diff-gate"), "Code Review", "a row and a failure line read the gate the same way");
assert.equal(isReviewGate("execution"), false, "execution is not a gate: no person is owed a decision");

// --- 2. Oldest first, ties by updatedAt then id, unmeasured last -----------
const tie = orderQueueRows([
  { id: "c_unknown", enteredAt: null, ageSource: "unknown", updatedAt: T + 9 * DAY },
  { id: "b_later", enteredAt: T, ageSource: "entered", updatedAt: T + 2 },
  { id: "a_earlier", enteredAt: T, ageSource: "entered", updatedAt: T + 1 },
  { id: "z_oldest", enteredAt: T - 3 * DAY, ageSource: "entered", updatedAt: T },
]);
assert.deepEqual(
  tie.map((row) => row.id),
  ["z_oldest", "b_later", "a_earlier", "c_unknown"],
  "the oldest wait is first, the tie breaks on the most recently touched, and an unmeasured row sorts last",
);

// With the time and the last-touched stamp equal, the id decides -- otherwise
// two cards that never move would still swap places between reads.
assert.deepEqual(
  orderQueueRows([
    { id: "b", enteredAt: T, ageSource: "entered", updatedAt: T },
    { id: "a", enteredAt: T, ageSource: "entered", updatedAt: T },
  ]).map((row) => row.id),
  ["a", "b"],
  "equal time, equal touch: the id breaks the tie so the order stops moving",
);

// The same rows handed over in a different order produce the same queue: an
// order that depends on array position is an order that depends on the RPC.
assert.deepEqual(
  orderQueueRows([...tie].reverse()).map((row) => row.id),
  tie.map((row) => row.id),
  "the order is a property of the rows, not of the order they arrived in",
);

// --- 3. Three age bases, three cells, one clock ----------------------------
const ages = reviewQueueRows({
  cards: [card("entered_card"), card("bound_card"), card("blank_card")],
  notifications: [
    // An unread completion is a review request owed to a person: that is the
    // wait's own start, so the cell is exact.
    event("entered_card", "completed", T),
    // A card whose only history is a machine stall it already recovered from:
    // there is no gate entry in the data, so the age is a bound read off the
    // oldest record it does have.
    event("bound_card", "error", T - 6 * DAY, { resolvedAt: T - 5 * DAY }),
  ],
});
const byId = Object.fromEntries(ages.map((row) => [row.id, row]));
assert.equal(byId.entered_card.ageSource, "entered", "an unread review request dates the wait exactly");
assert.equal(byId.bound_card.ageSource, "since_created", "history without an open request only bounds it");
assert.equal(byId.blank_card.ageSource, "unknown", "a card with no record at all has no age");

assert.equal(queueAgeCell(byId.entered_card, T + 4 * DAY), "4d", "an exact age prints bare");
assert.equal(
  queueAgeCell(byId.bound_card, T + 4 * DAY),
  "~10d",
  "a bound prints with the derived marker, counted from the oldest record the card has",
);
assert.equal(queueAgeCell(byId.blank_card, T + 4 * DAY), "\u2014", "an unknown age prints a dash, never 0d");

// A future timestamp (a clock skew, a ledger row from another machine) clamps
// to zero rather than printing a negative wait.
assert.equal(queueAgeCell(byId.entered_card, T - 5 * DAY), "0m", "skew never renders a negative wait");

// --- 3b. Hours under a day, days after: the unit a reader can act on ------
// The defect this replaced: a card waiting since this morning read `0d`, so a
// queue whose oldest card was hours old told the reader nothing at all.
const hoursAgo = (hours) =>
  queueAgeCell({ enteredAt: T - hours * 3600_000, ageSource: "entered" }, T);
assert.equal(hoursAgo(0.5), "30m", "half an hour is minutes, not zero");
assert.equal(hoursAgo(3), "3h", "three hours reads three hours");
assert.equal(hoursAgo(23.5), "23h", "and it stays in hours until the day flips");
assert.equal(hoursAgo(25), "1d", "a day and an hour reads a day");
assert.equal(hoursAgo(24 * 4), "4d", "days keep reading days");
assert.equal(
  queueAgeCell({ enteredAt: T - 5 * 3600_000, ageSource: "since_created" }, T),
  "~5h",
  "a bound uses the same unit, so `~` does not change how the number is read",
);
assert.notEqual(
  queueAgeCell({ enteredAt: T - 5 * 3600_000, ageSource: "entered" }, T),
  "0d",
  "this is the regression itself: a fresh wait must never read zero days",
);

// --- 4. The clock moves the cell, not the data ----------------------------
const before = reviewQueueRows({ cards: [card("p")], notifications: [event("p", "completed", T)] });
assert.equal(queueAgeCell(before[0], T + 1 * DAY), "1d");
assert.equal(queueAgeCell(before[0], T + 4 * DAY), "4d", "the same row read three days later says three days more");

// --- 5. The badge is count and oldest, and `0` is not a panel ------------
const badge = reviewQueueBadge(before, { nowMs: T + 4 * DAY });
assert.deepEqual(badge, { count: 1, oldest: "4d", label: "1 · 4d" }, "the trigger reads count · oldest");
assert.equal(
  reviewQueueBadge(
    [{ enteredAt: T - 5 * 3600_000, ageSource: "entered", waitingOn: "human", id: "x" }],
    { ledgerOk: true, nowMs: T },
  ).label,
  "1 · 5h",
  "a queue younger than a day badges its hours, not `0d`",
);
assert.equal(
  reviewQueueBadge([], { nowMs: T }).label,
  "0",
  "an empty queue reads 0 — it is a reading, not an absent panel",
);
assert.equal(
  reviewQueueBadge(before, { ledgerOk: false, nowMs: T }).label,
  "\u2014",
  "a failed read is a dash, never 0: nothing is not the same as nought",
);
assert.equal(
  reviewQueueBadge([], { ledgerOk: false }).label,
  "\u2014",
  "and it stays a dash even when the cards are missing too",
);

// --- 6. Who is waiting, from the ledger -----------------------------------
assert.equal(isHumanWait(event("x", "question", T)), true, "a question is a person's turn");
assert.equal(
  isHumanWait(event("x", "question", T, { resolvedAt: T + 1 })),
  false,
  "an answered question is nobody's turn",
);
assert.equal(isHumanWait(event("x", "completed", T)), true, "an unread completion is a review request owed");
assert.equal(
  isHumanWait(event("x", "completed", T, { readAt: T + 1 })),
  true,
  "a review request that was read but not resolved is still owed: reading is not approving",
);
assert.equal(
  isHumanWait(event("x", "completed", T, { resolvedAt: T + 1 })),
  false,
  "a resolved review request is history",
);
assert.equal(isHumanWait(event("x", "paused", T)), false, "a pause is not a human wait");
assert.equal(isSystemWait(event("x", "error", T)), true, "a failure is the machine's turn");
assert.equal(isSystemWait(event("x", "error", T, { archivedAt: T + 1 })), false, "an archived one is history");

// --- 7. What the projection excludes --------------------------------------
const mixed = reviewQueueRows({
  cards: [
    card("question_card"),
    card("review_card", "diff-gate"),
    card("running_card", "int-gate", { activity: "running" }),
    card("failed_card", "plan-gate"),
    card("read_card", "gate", { updatedAt: T - 1000 }),
    card("not_a_gate", "execution"),
    card("terminal", "completed"),
  ],
  notifications: [
    event("question_card", "question", T),
    event("review_card", "completed", T - 1),
    event("failed_card", "error", T - 2),
    event("read_card", "completed", T - 9 * DAY, { readAt: T - 8 * DAY }),
  ],
});
assert.deepEqual(
  mixed.map((row) => row.id),
  ["read_card", "review_card", "question_card"],
  "only cards a person owes a move on, oldest first: the running card, the failed one and the non-gate ones are out",
);
assert.equal(
  mixed[0].ageSource,
  "entered",
  "a review request that was read but not resolved still dates the wait from when the stage finished",
);
assert.equal(mixed[0].waitingOn, "human", "and it is the reader's turn whether or not they have glanced at it");
assert.equal(mixed[1].waitingOn, "human");
assert.equal(mixed[2].waitingOn, "human");

// An open question outranks an older completion: the newest open human wait is
// the one the reader is being asked about.
const newest = attributionOf(card("q"), [
  event("q", "completed", T - 10 * DAY),
  event("q", "question", T - 1 * DAY),
]);
assert.deepEqual(newest, { waitingOn: "human", enteredAt: T - 1 * DAY, ageSource: "entered" });

// --- 8. A failed read is never an empty queue -----------------------------
const cache = [card("a", "gate"), card("b", "diff-gate")];
const failed = reviewQueueRows({ cards: cache, notifications: [], ledgerOk: false });
assert.deepEqual(
  failed.map((row) => row.id),
  ["a", "b"],
  "when the ledger cannot be read the gate cards are still reported, unmeasured",
);
assert.deepEqual(
  failed.map((row) => row.ageSource),
  ["unknown", "unknown"],
  "and every age says it is unknown rather than inventing one from updatedAt",
);

// --- 9. A record with no timestamp is unknown, not 1970 -------------------
// The ledger is written by more than one writer, and an event with no
// `occurredAt` used to collapse to zero -- printing a wait of twenty thousand
// days and sorting that card to the top, which is the confidently wrong number
// the whole interface is built to avoid.
const undated = reviewQueueRows({
  cards: [card("undated_card")],
  notifications: [
    { cardId: "undated_card", kind: "completed", readAt: null, resolvedAt: null, archivedAt: null },
  ],
});
assert.equal(undated.length, 1, "a review request nobody dated is still the reader's turn");
assert.equal(undated[0].ageSource, "unknown", "no occurredAt means no entry time, not epoch zero");
assert.equal(queueAgeCell(undated[0], T), "\u2014", "and it prints a dash instead of an enormous number");
assert.equal(
  reviewQueueRows({
    cards: [card("undated_card")],
    notifications: [
      { cardId: "undated_card", kind: "question", occurredAt: null, readAt: null, resolvedAt: null, archivedAt: null },
    ],
  })[0].ageSource,
  "unknown",
  "an undated question is undated too",
);

console.log("review queue projection test ok");

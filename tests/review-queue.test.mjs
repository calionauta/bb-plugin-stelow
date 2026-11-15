import assert from "node:assert/strict";
import {
  REVIEW_QUEUE_GATES,
  REVIEW_QUEUE_IN_GATE_CELL,
  REVIEW_QUEUE_UNOWNED_CELL,
  attributionOf,
  gateClockOf,
  isHumanWait,
  isReviewGate,
  isSystemWait,
  orderQueueRows,
  queueAgeCell,
  queueBadgeAria,
  reviewGateLabel,
  reviewQueueBadge,
  reviewQueueRows,
} from "../lib/review-queue.mjs";

/**
 * The review queue's answers, asked of the projection rather than the rail.
 *
 * Four things here are the difference between a queue and a sorted list of cards
 * in gate columns:
 *
 *  - the AGE comes off the card's own gate entry (`stageEnteredAt`), never off an
 *    inbox event: a ledger row has no stage on it, so the newest human event can
 *    belong to a gate the card left days ago. The fallback is `createdAt`, and it
 *    prints a word (`in gate`), never a number the data cannot support;
 *  - the ORDER is oldest-first and survives a tie without falling back to
 *    whatever order the RPC happened to return;
 *  - WHO IS WAITING comes off the inbox ledger, so a card a worker is holding —
 *    or one whose failure a worker owes — is not counted as the reader's turn;
 *  - a card nobody owns is LISTED with the words `no owner named` and counted
 *    nowhere, because hiding it takes a card in a gate off the only surface that
 *    lists gates, and counting it makes the badge mean "cards in gates".
 *
 * The whole file is pure: no DOM, no clock, no database. `nowMs` is an argument
 * everywhere, which is what lets "drive the clock three days" be one line.
 */

const DAY = 86_400_000;
const HOUR = 3_600_000;
const T = Date.UTC(2026, 8, 1, 12, 0, 0);

/** A card in a gate column, idle, as `listCards` hands it over. */
function card(id, stage = "gate", overrides = {}) {
  return {
    id,
    displayName: `Card ${id}`,
    name: id,
    stage,
    activity: "idle",
    updatedAt: T,
    stageEnteredAt: null,
    createdAt: null,
    ...overrides,
  };
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
const row = (id, clock, updatedAt, ageSource = "stage") => ({
  id,
  enteredAt: ageSource === "stage" ? clock : null,
  createdAt: ageSource === "stage" ? null : clock,
  ageSource,
  waitingOn: "human",
  updatedAt,
});
const tie = orderQueueRows([
  row("c_unknown", null, T + 9 * DAY, "unknown"),
  row("b_later", T, T + 2),
  row("a_earlier", T, T + 1),
  row("z_oldest", T - 3 * DAY, T),
]);
assert.deepEqual(
  tie.map((entry) => entry.id),
  ["z_oldest", "b_later", "a_earlier", "c_unknown"],
  "the oldest wait is first, the tie breaks on the most recently touched, and an unmeasured row sorts last",
);

// A card with no stage entry is dated by its creation, but that is a bound and
// not a measurement: it goes after every card whose wait is known, and the
// creation date only orders it against other bounds. Sorting it by the bound
// would let a month-old card moved into the gate an hour ago outrank a card that
// has been ignored for two days.
assert.deepEqual(
  orderQueueRows([
    row("entered", T - HOUR, T),
    row("created", T - 5 * DAY, T, "created"),
    row("older_bound", T - 9 * DAY, T, "created"),
  ]).map((r) => r.id),
  ["entered", "older_bound", "created"],
  "a bound never outranks a measured wait; among bounds, the older creation is still older",
);

// With the time and the last-touched stamp equal, the id decides -- otherwise
// two cards that never move would still swap places between reads.
assert.deepEqual(
  orderQueueRows([row("b", T, T), row("a", T, T)]).map((entry) => entry.id),
  ["a", "b"],
  "equal time, equal touch: the id breaks the tie so the order stops moving",
);

// The same rows handed over in a different order produce the same queue: an
// order that depends on array position is an order that depends on the RPC.
assert.deepEqual(
  orderQueueRows([...tie].reverse()).map((entry) => entry.id),
  tie.map((entry) => entry.id),
  "the order is a property of the rows, not of the order they arrived in",
);

// --- 3. The age is the card's gate entry, and nothing else ----------------
// The defect this replaced: the age was read off the newest human inbox event,
// and an event belongs to whichever stage it happened in. A card that finished
// review eight days ago and entered code review an hour ago read `8d`.
const clocked = {
  cards: [
    card("stale_event", "diff-gate", { stageEnteredAt: T - HOUR, createdAt: T - 30 * DAY }),
    card("no_entry", "plan-gate", { createdAt: T - 2 * DAY }),
    card("no_clock", "int-gate"),
  ],
  notifications: [
    // Old news: the completion that put it in front of a reviewer last week.
    event("stale_event", "completed", T - 8 * DAY),
    event("no_entry", "completed", T - 8 * DAY),
    event("no_clock", "completed", T - 8 * DAY),
  ],
};
const clockedById = Object.fromEntries(reviewQueueRows(clocked).map((entry) => [entry.id, entry]));
assert.equal(clockedById.stale_event.ageSource, "stage", "the entry into the current gate is the clock");
assert.equal(
  queueAgeCell(clockedById.stale_event, T),
  "1h",
  "an eight-day-old inbox event cannot date a one-hour gate wait: the event does not creep back in",
);
assert.equal(clockedById.no_entry.ageSource, "created", "no entry falls back to the card's creation");
assert.equal(
  queueAgeCell(clockedById.no_entry, T),
  REVIEW_QUEUE_IN_GATE_CELL,
  "and prints a word, not a number it cannot stand behind",
);
assert.equal(clockedById.no_clock.ageSource, "unknown", "neither clock is unknown, not creation by default");
assert.equal(queueAgeCell(clockedById.no_clock, T), "\u2014", "an unknown age prints a dash, never 0d");

// A future timestamp (a clock skew, a ledger row from another machine) clamps
// to zero rather than printing a negative wait.
assert.equal(queueAgeCell(clockedById.stale_event, T - 5 * DAY), "0m", "skew never renders a negative wait");

// --- 3b. Hours under a day, days after: the unit a reader can act on ------
const hoursAgo = (hours) => queueAgeCell({ enteredAt: T - hours * HOUR, ageSource: "stage" }, T);
assert.equal(hoursAgo(0.5), "30m", "half an hour is minutes, not zero");
assert.equal(hoursAgo(3), "3h", "three hours reads three hours");
assert.equal(hoursAgo(23.5), "23h", "and it stays in hours until the day flips");
assert.equal(hoursAgo(25), "1d", "a day and an hour reads a day");
assert.equal(hoursAgo(24 * 4), "4d", "days keep reading days");
assert.notEqual(hoursAgo(5), "0d", "this is the regression itself: a fresh wait must never read zero days");

// --- 4. The clock moves the cell, not the data ----------------------------
const before = reviewQueueRows({
  cards: [card("p", "gate", { stageEnteredAt: T })],
  notifications: [event("p", "completed", T)],
});
assert.equal(queueAgeCell(before[0], T + DAY), "1d");
assert.equal(queueAgeCell(before[0], T + 4 * DAY), "4d", "the same row read three days later says three days more");

// --- 5. The badge counts what is the reader's, and names the rest ---------
assert.deepEqual(
  reviewQueueBadge(before, { nowMs: T + 4 * DAY }),
  { count: 1, unowned: 0, oldest: "4d", label: "1 · 4d" },
  "the trigger reads count · oldest",
);
const oneHumanOneOrphan = reviewQueueRows({
  cards: [
    card("mine", "gate", { stageEnteredAt: T - 5 * HOUR }),
    card("everyones", "diff-gate", { stageEnteredAt: T - 9 * DAY }),
  ],
  notifications: [event("mine", "completed", T - 5 * HOUR)],
});
const split = reviewQueueBadge(oneHumanOneOrphan, { nowMs: T });
assert.deepEqual(
  split,
  // The unowned card rides on the chip: the door is the only surface visible
  // while the rail is shut, so it may not read the same as a queue of one.
  { count: 1, unowned: 1, oldest: "5h", label: "1 · 5h +1" },
  "an unowned card is not in the count, and it is not silently dropped either: `unowned` carries it",
);
assert.equal(
  queueAgeCell(oneHumanOneOrphan.find((entry) => entry.id === "everyones"), T),
  REVIEW_QUEUE_UNOWNED_CELL,
  "and where its age would be, the row says who is not on it",
);
assert.equal(
  reviewQueueBadge([{ enteredAt: T - 5 * HOUR, ageSource: "stage", waitingOn: "human", id: "x" }], {
    ledgerOk: true,
    nowMs: T,
  }).label,
  "1 · 5h",
  "a queue younger than a day badges its hours, not `0d`",
);
assert.equal(reviewQueueBadge([], { nowMs: T }).label, "0", "an empty queue reads 0 — a reading, not an absent panel");
assert.equal(
  reviewQueueBadge(before, { ledgerOk: false, nowMs: T }).label,
  "\u2014",
  "a failed read is a dash, never 0: nothing is not the same as nought",
);
assert.equal(reviewQueueBadge([], { ledgerOk: false }).label, "\u2014", "and it stays a dash with no cards at all");

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
assert.equal(isHumanWait(event("x", "completed", T, { resolvedAt: T + 1 })), false, "a resolved request is history");
assert.equal(isHumanWait(event("x", "paused", T)), false, "a pause is not a human wait");
assert.equal(isSystemWait(event("x", "error", T)), true, "a failure is the machine's turn");
assert.equal(isSystemWait(event("x", "error", T, { archivedAt: T + 1 })), false, "an archived one is history");

// The human edge wins over everything, in either order of arrival.
assert.deepEqual(
  attributionOf(card("q"), [event("q", "completed", T - 10 * DAY), event("q", "question", T - DAY)]),
  { waitingOn: "human" },
  "a question and a completion both name a person; one verdict, not two",
);

// --- 7. What the projection excludes --------------------------------------
const mixed = reviewQueueRows({
  cards: [
    card("question_card", "gate", { stageEnteredAt: T - 2 * HOUR }),
    card("review_card", "diff-gate", { stageEnteredAt: T - 3 * HOUR }),
    card("running_card", "int-gate", { activity: "running", stageEnteredAt: T - 9 * DAY }),
    card("failed_card", "plan-gate", { stageEnteredAt: T - 8 * DAY }),
    card("not_a_gate", "execution"),
    card("terminal", "completed"),
  ],
  notifications: [
    event("question_card", "question", T - 2 * HOUR),
    event("review_card", "completed", T - 3 * HOUR),
    event("failed_card", "error", T - 8 * DAY),
  ],
});
assert.deepEqual(
  mixed.map((entry) => entry.id),
  ["review_card", "question_card"],
  "only cards waiting on a person: the running card, the failed one and the non-gate ones are out",
);
assert.deepEqual(mixed.map((entry) => entry.waitingOn), ["human", "human"]);
assert.equal(mixed[0].gate, "Code Review", "a row names its gate in the catalog's words");

// --- 8. A failed read is never an empty queue, and never a false orphan ---
const cache = [
  card("a", "gate", { stageEnteredAt: T - HOUR }),
  card("b", "diff-gate", { stageEnteredAt: T - 2 * HOUR }),
];
const failed = reviewQueueRows({ cards: cache, notifications: [], ledgerOk: false });
assert.deepEqual(
  failed.map((entry) => entry.id),
  ["b", "a"],
  "when the ledger cannot be read the gate cards are still reported, still ordered by their own clocks",
);
assert.deepEqual(
  failed.map((entry) => entry.waitingOn),
  ["unknown", "unknown"],
  "and nobody claims they are unowned: a failed read is UNKNOWN, not 'nobody'",
);
assert.deepEqual(
  failed.map((entry) => queueAgeCell(entry, T)),
  ["2h", "1h"],
  "the age is a card fact, so a failed ledger read does not blank it",
);

// --- 9. An unowned card with no record at all -----------------------------
const orphan = reviewQueueRows({ cards: [card("orphan", "gate", { stageEnteredAt: null })], notifications: [] });
assert.equal(orphan.length, 1, "a gate card nobody owns is listed, not dropped");
assert.equal(orphan[0].waitingOn, "unattributed");
assert.equal(queueAgeCell(orphan[0], T), REVIEW_QUEUE_UNOWNED_CELL, "the cell names the problem, not a dash");

// --- 10. The gate clock, alone --------------------------------------------
assert.deepEqual(gateClockOf(card("x", "gate", { stageEnteredAt: 5, createdAt: 1 })), {
  enteredAt: 5,
  createdAt: null,
  ageSource: "stage",
});
assert.deepEqual(gateClockOf(card("x", "gate", { createdAt: 1 })), {
  enteredAt: null,
  createdAt: 1,
  ageSource: "created",
});
assert.deepEqual(gateClockOf(card("x", "gate", { stageEnteredAt: "junk", createdAt: null })), {
  enteredAt: null,
  createdAt: null,
  ageSource: "unknown",
});

// --- 9b. The door announces three states, not two -------------------------
// The trigger's accessible name is the only thing a reader hears until the rail
// is open, so a read still in flight must not be announced as a failed one.
{
  const empty = { count: 0, unowned: 0, oldest: null, label: "0" };
  assert.equal(
    queueBadgeAria(empty, "checking"),
    "Review queue, checking what is waiting",
    "a first read in flight says it is checking",
  );
  assert.equal(
    queueBadgeAria(empty, "failed"),
    "Review queue, the ledger could not be read",
    "and only a read that came back wrong says so",
  );
  assert.equal(
    queueBadgeAria({ count: 0, unowned: 3, oldest: null, label: "0 +3" }, "ok"),
    "Review queue: 0 waiting on you, 3 without an owner",
    "the unowned cards are spoken, so the door's count is not the whole story",
  );
}

// --- 10. A failed read still knows what a worker holds ---------------------
// The held check reads the card, not the ledger: on a failed read the attribution
// is `unknown`, so a filter that rode on the attribution would let a running card
// back in as an unowned row -- precisely the state where nobody can tell it apart.
{
  const cards = [
    card("free"),
    card("running", "gate", { activity: "running" }),
    card("asking", "plan-gate", { activity: "held" }),
  ];
  const rows = reviewQueueRows({ cards, notifications: [], ledgerOk: false });
  assert.deepEqual(rows.map((row) => row.id), ["free"], "a card a worker holds is not on the reader, failed read or not");
  assert.equal(rows[0].waitingOn, "unknown", "and the card that is listed does not claim an owner either");
}

console.log("review queue projection test ok");

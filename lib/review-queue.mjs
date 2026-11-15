/**
 * The review queue: which cards are waiting on a person, and for how long.
 *
 * The board answers "where is everything". It cannot answer "what is on me
 * right now" — a card in a gate column looks exactly like a card in a gate
 * column, whether it has been sitting there twenty minutes or a week, and the
 * four gate columns are at four different points of a board that scrolls.
 *
 * This module is that answer, and nothing else: a projection over two things the
 * board already holds — the cards it renders, and the inbox ledger the plugin
 * already records. It is pure, so the ordering rules, the age bases and the
 * badge are decided here once and rendered, not re-derived per surface.
 *
 * Three rules are load-bearing and are why this is a module rather than a few
 * comparisons in the rail:
 *
 * 1. **Waiting-on comes from the ledger, never from a guess.** Who owes the next
 *    move is what the inbox events say: a question is owed to a person, a pause
 *    or a failure is owed to a worker, and a stage that finished is owed to
 *    whoever reads the review. `lib/wait-attribution.mjs` owns those kinds and
 *    this module imports them, so there is one definition of "a human wait" in
 *    the tree. An assignee comparison would be a second, quieter one. The card's
 *    own `activity` is read in exactly one place — a card a worker is *currently*
 *    running or holding owes nobody a review yet — and that is a signal on the
 *    card, not a second guess at the ledger.
 *
 * 2. **An age has a source, or it has no number.** `stage` is the card's own
 *    entry into the gate it is sitting in (`stageEnteredAt`, carried on the same
 *    `listCards` read). `created` is the fallback for a card the ledger never
 *    recorded entering: it has been in a gate for at most its whole life, so the
 *    cell says `in gate` instead of a number nobody can stand behind. `unknown`
 *    renders an em dash. The one thing this module will not do is date a wait
 *    from `updatedAt`: a sync poll moves that column without the card having
 *    moved (see `server/cards.ts`), so a number derived from it is a confident
 *    lie. Nor from an inbox event: a ledger row carries no stage, so an event
 *    belongs to whichever stage it happened in, and a card that finished review
 *    last week was dated from that review while it sat in code review this
 *    morning. The product decision is explicit: a wrong number is worse than an
 *    honest blank.
 *
 * 3. **A failed read never becomes an empty queue.** `ledgerOk: false` keeps
 *    every gate card in the projection with `ageSource: "unknown"`; the rail
 *    then says it could not check, which is recoverable. Dropping the rows
 *    instead would render "0 waiting on you" over a board full of gates.
 */

import { HUMAN_KINDS, SYSTEM_KINDS } from "./wait-attribution.mjs";
import { elapsedUnits } from "./relative-time.mjs";
import { STAGE_CATALOG } from "./workflow-catalog.mjs";

/** The rail's geometry, published so a layout test asserts it rather than a class. */
export const REVIEW_QUEUE_WIDTH_PX = 280;
export const REVIEW_QUEUE_ROW_PX = 44;

/**
 * Where the rail sits, as data rather than as utility classes.
 *
 * `position: fixed` and `right: 0` are the mechanism behind the layout promise —
 * the panel costs the board no width — so they live where a test can read them
 * back off the rendered element. Tailwind classes cover how it is painted;
 * nothing that decides whether a column gets narrower is in a class string.
 */
export const REVIEW_QUEUE_RAIL_STYLE = Object.freeze({
  position: "fixed",
  top: 0,
  bottom: 0,
  right: 0,
  zIndex: 40,
  width: REVIEW_QUEUE_WIDTH_PX,
});

/**
 * How often the visible ages are recomputed. The data does not change on this
 * tick — the ages do, because they are read against the clock. Thirty seconds is
 * under the shortest unit the cell prints (days), so a tick is never visible as
 * a jump: it exists so a rail left open overnight is not reading yesterday.
 */
export const REVIEW_QUEUE_TICK_MS = 30_000;


/**
 * The gates, from the catalog rather than from a list here.
 *
 * `requires_approval` is what makes a stage a gate: a person has to say yes
 * before the card continues. Four stages carry it today (Product Review, Design
 * Review, Technical Review, Code Review) and this projection has to follow the
 * catalog when that changes, not publish a fifth copy of the set.
 */
export const REVIEW_QUEUE_GATES = Object.freeze(
  STAGE_CATALOG.filter((stage) => stage.requires_approval === true).map((stage) =>
    Object.freeze({ id: stage.id, label: stage.label }),
  ),
);

const GATE_BY_ID = Object.freeze(
  Object.fromEntries(REVIEW_QUEUE_GATES.map((gate) => [gate.id, gate])),
);

/** Activities where the card is held by a worker or a lock, so its gate is nobody's turn yet. */
const HELD_ACTIVITIES = new Set(["running", "held", "error"]);

const emDash = "\u2014";

/**
 * The two cells that are words rather than numbers.
 *
 * A card in a gate with no owner is not "unknown", it is `no owner named`: the
 * queue's whole point is that a wait nobody owns is worth showing, and a dash
 * would hide it behind the same glyph a failed read uses. `in gate` is the other:
 * the card is here, but the ledger never recorded entering, so there is no wait
 * to print.
 */
export const REVIEW_QUEUE_UNOWNED_CELL = "no owner named";
export const REVIEW_QUEUE_IN_GATE_CELL = "in gate";

export function isReviewGate(stage) {
  return typeof stage === "string" && Object.hasOwn(GATE_BY_ID, stage);
}

export function reviewGateLabel(stage) {
  return GATE_BY_ID[stage]?.label ?? String(stage);
}

function at(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * A timestamp, or null when there is not one.
 *
 * `at()` above answers "what number do I compare" and 0 is the right answer for
 * a missing `updatedAt`. A missing `occurredAt` is a different question: 0 is
 * 1970, and a wait dated from 1970 prints "20772d" and sorts to the top of the
 * queue. Absent means absent.
 */
function finiteAt(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isOpen(event) {
  return event.archivedAt == null && event.resolvedAt == null;
}

/**
 * A human is owed this event.
 *
 * `question` is `wait-attribution`'s human kind. `completed` is not a wait the
 * card sat in — it is a review request, and it is owed to a person until it is
 * resolved, not until it is read.
 *
 * That last word is where this predicate deliberately parts company with
 * `reviewWaitMs`, which measures how long a finished card has sat *unread*. A
 * different question: the inbox is asking how quickly people notice, and the
 * queue is asking whether the card still needs a person. Reading a review is not
 * approving it, so `readAt` is not consulted here — an age that changed because
 * somebody happened to look would be a number that moves without the card moving.
 */
export function isHumanWait(event) {
  if (!isOpen(event)) return false;
  return HUMAN_KINDS.has(event.kind) || event.kind === "completed";
}

export function isSystemWait(event) {
  return isOpen(event) && SYSTEM_KINDS.has(event.kind);
}

function groupByCard(notifications) {
  const grouped = new Map();
  for (const event of notifications) {
    if (!event || typeof event.cardId !== "string") continue;
    const rows = grouped.get(event.cardId);
    if (rows) rows.push(event);
    else grouped.set(event.cardId, [event]);
  }
  return grouped;
}

/**
 * Who owes this card its next move -- and only who.
 *
 * The WHEN is the card's own stage entry (`stageEnteredAt`), never an event: a
 * ledger row has no stage on it, so the newest open human event can belong to a
 * gate the card left days ago, and dating the current gate from it understates
 * the wait and reorders the queue. Attribution comes from the ledger because
 * "whose turn is it" is what the events say; the clock comes from the card
 * because "how long in this gate" is what the card says.
 */
export function attributionOf(card, events = []) {
  const newestFirst = [...events].sort((a, b) => (finiteAt(b.occurredAt) ?? 0) - (finiteAt(a.occurredAt) ?? 0));
  if (newestFirst.some(isHumanWait)) return { waitingOn: "human" };
  if (newestFirst.some(isSystemWait) || HELD_ACTIVITIES.has(card.activity)) {
    return { waitingOn: "system" };
  }
  return { waitingOn: "unattributed" };
}

/**
 * The card's own clock for the gate it is in.
 *
 * `stageEnteredAt` is the answer. A card the ledger never recorded entering gets
 * `createdAt` as a labelled fallback -- it has been in a gate for at most its
 * whole life, and `in gate` says exactly that instead of inventing a wait. No
 * clock at all is `unknown`, which prints a dash.
 */
export function gateClockOf(card) {
  const enteredAt = finiteAt(card?.stageEnteredAt);
  if (enteredAt !== null) return { enteredAt, createdAt: null, ageSource: "stage" };
  const createdAt = finiteAt(card?.createdAt);
  if (createdAt !== null) return { enteredAt: null, createdAt, ageSource: "created" };
  return { enteredAt: null, createdAt: null, ageSource: "unknown" };
}

/**
 * Oldest first, because the queue is a work order.
 *
 * Rows with no timestamp sort last — they are not older than the others, they are
 * unmeasured, and putting them first would push a card somebody has actually
 * been ignoring down the list. The tie-break is `updatedAt` descending (on a tie,
 * the one touched most recently is the one with news) and then the id, because a
 * sort that falls through to array order is a sort whose output depends on which
 * RPC landed first.
 */
function clockOf(row) {
  return row.enteredAt ?? row.createdAt ?? null;
}

export function orderQueueRows(rows) {
  return [...rows].sort((a, b) => {
    const aAt = clockOf(a);
    const bAt = clockOf(b);
    const aKnown = aAt !== null;
    const bKnown = bAt !== null;
    if (aKnown !== bKnown) return aKnown ? -1 : 1;
    if (aKnown && aAt !== bAt) {
      return (/** @type {number} */ (aAt)) - (/** @type {number} */ (bAt));
    }
    if (a.updatedAt !== b.updatedAt) return b.updatedAt - a.updatedAt;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

function rowOf(card, attribution) {
  return {
    id: String(card.id),
    name: String(card.displayName ?? card.name ?? card.id),
    stage: String(card.stage),
    gate: reviewGateLabel(card.stage),
    updatedAt: at(card.updatedAt),
    ...attribution,
    ...gateClockOf(card),
  };
}

/**
 * The rows, from the cards the board holds and the ledger it recorded.
 *
 * `ledgerOk: false` is a read that failed, not a ledger that is empty: every
 * gate card stays, unmeasured. The distinction between the two is the whole
 * "never an empty board" rule, so it arrives as an argument rather than being
 * inferred from an empty array.
 */
export function reviewQueueRows({ cards = [], notifications = [], ledgerOk = true } = {}) {
  const byCard = groupByCard(notifications);
  const rows = [];
  for (const card of cards) {
    if (!isReviewGate(card.stage)) continue;
    // A ledger that could not be read is not a ledger that says nobody owns
    // anything: `unknown` draws the age and lets the rail say the ownership read
    // failed, where `unattributed` would print "no owner named" on every card.
    const attribution = ledgerOk
      ? attributionOf(card, byCard.get(card.id) ?? [])
      : { waitingOn: "unknown" };
    // A gate card a worker holds is not on the reader, and counting it would
    // make the number mean "cards in gates" instead of "cards waiting on you".
    if (attribution.waitingOn === "system") continue;
    rows.push(rowOf(card, attribution));
  }
  return orderQueueRows(rows);
}

/**
 * One age cell: `6h`, `3d`, `~2h`, or an em dash.
 *
 * Hours under a day, days after it, floored -- the unit a reader can act on.
 * Days alone made every fresh wait read `0d`, so a queue whose oldest card had
 * been sitting since the morning showed `3 * 0d`, which is the one thing the
 * badge must never say: nothing. The scale lives in `relative-time.mjs` beside
 * the recency clock so the flips are stated once.
 */
export function queueAgeCell(row, nowMs) {
  // Nobody owns this wait. That is the reading, so it goes where the age would: a
  // dash would say "no time recorded" and hide the card's actual problem.
  if (row.waitingOn === "unattributed") return REVIEW_QUEUE_UNOWNED_CELL;
  if (row.ageSource === "created") return REVIEW_QUEUE_IN_GATE_CELL;
  if (row.ageSource !== "stage" || row.enteredAt === null || !Number.isFinite(nowMs)) return emDash;
  return elapsedUnits(row.enteredAt, nowMs);
}

/**
 * The trigger's reading: how many, and how long the oldest has waited.
 *
 * `—` rather than `0` when the read failed, and `0` rather than a panel when the
 * queue is genuinely empty: the two states look alike from the outside and mean
 * opposite things.
 */
export function reviewQueueBadge(rows, { ledgerOk = true, nowMs = 0 } = {}) {
  // The count is cards waiting on a PERSON, and nothing else. A gate card nobody
  // owns is listed beside them and named by `+N without an owner`; counting it
  // would make this the board's number ("cards in gates") instead of the queue's,
  // and hiding it instead would take a card in a gate off the one surface that
  // lists gates.
  const counted = rows.filter((row) => row.waitingOn === "human");
  const unowned = rows.filter((row) => row.waitingOn === "unattributed").length;
  const count = counted.length;
  if (!ledgerOk) return { count, unowned, oldest: null, label: emDash };
  if (count === 0) return { count, unowned, oldest: null, label: "0" };
  const measured = counted.filter((row) => row.enteredAt !== null);
  if (measured.length === 0) return { count, unowned, oldest: null, label: `${count} · ${emDash}` };
  const oldestRow = measured.reduce((oldest, row) =>
    (/** @type {number} */ (row.enteredAt)) < (/** @type {number} */ (oldest.enteredAt))
      ? row
      : oldest,
  );
  const oldest = queueAgeCell(oldestRow, nowMs);
  return { count, unowned, oldest, label: `${count} · ${oldest}` };
}

/** The four readings, in one place, because the cells are the interface's promise. */
export const REVIEW_QUEUE_AGE_LEGEND = Object.freeze([
  Object.freeze({ cell: "6h, 3d", meaning: "how long it has been in this gate, waiting on you" }),
  Object.freeze({
    cell: REVIEW_QUEUE_IN_GATE_CELL,
    meaning:
      "in a gate the ledger never recorded an entry for, so there is no wait to print; it can be at most the card's age",
  }),
  Object.freeze({
    cell: REVIEW_QUEUE_UNOWNED_CELL,
    meaning: "in a gate and waiting on nobody: listed here, not counted above",
  }),
  Object.freeze({ cell: emDash, meaning: "no time was recorded, so there is no number" }),
]);

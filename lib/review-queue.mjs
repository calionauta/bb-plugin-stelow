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
 *    the tree. An assignee comparison would be a second, quieter one.
 *
 * 2. **An age has a source, or it has no number.** `entered` is the moment the
 *    card started owing a person the review it now owes. `since_created` is a
 *    bound read off the card's oldest recorded event — a card can only have been
 *    in a gate since it was last written, so the age it yields is at most the
 *    true wait and the cell says `~`. `unknown` renders an em dash. The one
 *    thing this module will not do is date a wait from `updatedAt`: a sync poll
 *    moves that column without the card having moved (see `server/cards.ts`), so
 *    a number derived from it is a confident lie. The product decision is
 *    explicit — a wrong number is worse than an honest blank.
 *
 * 3. **A failed read never becomes an empty queue.** `ledgerOk: false` keeps
 *    every gate card in the projection with `ageSource: "unknown"`; the rail
 *    then says it could not check, which is recoverable. Dropping the rows
 *    instead would render "0 waiting on you" over a board full of gates.
 */

import { HUMAN_KINDS, SYSTEM_KINDS } from "./wait-attribution.mjs";
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

const DAY_MS = 86_400_000;

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
    Object.freeze({ id: stage.id, label: stage.label, phase: stage.phase }),
  ),
);

export const REVIEW_QUEUE_GATE_IDS = Object.freeze(
  REVIEW_QUEUE_GATES.map((gate) => gate.id),
);

const GATE_BY_ID = Object.freeze(
  Object.fromEntries(REVIEW_QUEUE_GATES.map((gate) => [gate.id, gate])),
);

/** Activities where the card is held by a worker or a lock, so its gate is nobody's turn yet. */
const HELD_ACTIVITIES = new Set(["running", "held", "error"]);

const emDash = "\u2014";

export function isReviewGate(stage) {
  return typeof stage === "string" && Object.hasOwn(GATE_BY_ID, stage);
}

export function reviewGateLabel(stage) {
  return GATE_BY_ID[stage]?.label ?? String(stage);
}

function at(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function isOpen(event) {
  return event.archivedAt == null && event.resolvedAt == null;
}

/**
 * A human is owed this event.
 *
 * `question` is `wait-attribution`'s human kind. `completed` is not a wait the
 * card sat in — it is a review request, and it is owed to a person exactly until
 * somebody reads it: that is the same clock `reviewWaitMs` measures ("a finished
 * card that has sat unread"), read here for the card that is still sitting.
 */
export function isHumanWait(event) {
  if (!isOpen(event)) return false;
  if (HUMAN_KINDS.has(event.kind)) return true;
  return event.kind === "completed" && event.readAt == null;
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
 * Who owes this card its next move, and since when.
 *
 * Newest event first, because the newest open human wait is the one the reader
 * is looking at: a card that asked a question, was answered, and then finished a
 * stage is waiting on the review, not on the old question. This is the same
 * "the newest such row is the clock" rule `reviewWaitMs` already uses.
 */
export function attributionOf(card, events = []) {
  const newestFirst = [...events].sort((a, b) => at(b.occurredAt) - at(a.occurredAt));
  const human = newestFirst.find(isHumanWait);
  if (human) {
    return { waitingOn: "human", enteredAt: at(human.occurredAt), ageSource: "entered" };
  }
  if (newestFirst.some(isSystemWait)) {
    return { waitingOn: "system", enteredAt: null, ageSource: "unknown" };
  }
  if (HELD_ACTIVITIES.has(card.activity)) {
    return { waitingOn: "system", enteredAt: null, ageSource: "unknown" };
  }
  if (newestFirst.length > 0) {
    const oldest = Math.min(...newestFirst.map((event) => at(event.occurredAt)));
    return { waitingOn: "unattributed", enteredAt: oldest, ageSource: "since_created" };
  }
  return { waitingOn: "unattributed", enteredAt: null, ageSource: "unknown" };
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
export function orderQueueRows(rows) {
  return [...rows].sort((a, b) => {
    const aKnown = a.enteredAt !== null;
    const bKnown = b.enteredAt !== null;
    if (aKnown !== bKnown) return aKnown ? -1 : 1;
    if (aKnown && a.enteredAt !== b.enteredAt) return a.enteredAt - b.enteredAt;
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
    const attribution = ledgerOk
      ? attributionOf(card, byCard.get(card.id) ?? [])
      : { waitingOn: "unattributed", enteredAt: null, ageSource: "unknown" };
    // A gate card a worker holds is not on the reader, and counting it would
    // make the number mean "cards in gates" instead of "cards waiting on you".
    if (attribution.waitingOn === "system") continue;
    rows.push(rowOf(card, attribution));
  }
  return orderQueueRows(rows);
}

/**
 * One age cell: `4d`, `~4d`, or an em dash.
 *
 * Days and nothing else. A cell that says `3h` on one card and `5d` on the next
 * makes a reader compare unlike units across a column; the queue's question is
 * "how long has this been ignored", and a day is the unit that question is asked
 * in.
 */
export function queueAgeCell(row, nowMs) {
  if (row.enteredAt === null || row.ageSource === "unknown") return emDash;
  const days = Math.max(0, Math.floor((at(nowMs) - row.enteredAt) / DAY_MS));
  return row.ageSource === "since_created" ? `~${days}d` : `${days}d`;
}

/**
 * The trigger's reading: how many, and how long the oldest has waited.
 *
 * `—` rather than `0` when the read failed, and `0` rather than a panel when the
 * queue is genuinely empty: the two states look alike from the outside and mean
 * opposite things.
 */
export function reviewQueueBadge(rows, { ledgerOk = true, nowMs = 0 } = {}) {
  const count = rows.length;
  if (!ledgerOk) return { count, oldest: null, label: emDash };
  if (count === 0) return { count, oldest: null, label: "0" };
  const measured = rows.filter((row) => row.enteredAt !== null);
  if (measured.length === 0) return { count, oldest: null, label: `${count} · ${emDash}` };
  const oldestRow = measured.reduce((oldest, row) =>
    row.enteredAt < oldest.enteredAt ? row : oldest,
  );
  const oldest = queueAgeCell(oldestRow, nowMs);
  return { count, oldest, label: `${count} · ${oldest}` };
}

/**
 * Per-gate status, so a read that failed can name what it could not check.
 *
 * The four gates are read off one ledger snapshot, so a failed snapshot fails
 * all four — and the rail draws a retry per gate anyway, because "could not
 * check Code Review" is a sentence about one gate and a reader who only cares
 * about code review should not have to learn how the data is fetched. The retry
 * re-issues the one read the gate depends on.
 */
export function reviewQueueGateReads(rows, { ledgerOk = true } = {}) {
  return REVIEW_QUEUE_GATES.map((gate) => ({
    id: gate.id,
    label: gate.label,
    state: ledgerOk ? "ok" : "failed",
    count: rows.filter((row) => row.stage === gate.id).length,
  }));
}

/** The legend, in one place, because the three states are the interface's promise. */
export const REVIEW_QUEUE_AGE_LEGEND = Object.freeze([
  Object.freeze({ cell: "4d", meaning: "waiting on you for that many days" }),
  Object.freeze({ cell: "~4d", meaning: "at least that long, read off the card's own record" }),
  Object.freeze({ cell: emDash, meaning: "no time was recorded, so there is no number" }),
]);

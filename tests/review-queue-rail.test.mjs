import assert from "node:assert/strict";
import { createElement as h } from "react";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import {
  REVIEW_QUEUE_RAIL_ID,
  REVIEW_QUEUE_TRIGGER_ID,
  ReviewQueue,
} from "../components/board/review-queue.tsx";
import { REVIEW_QUEUE_GATES, REVIEW_QUEUE_TICK_MS } from "../lib/review-queue.mjs";

/**
 * The review queue as a reader meets it: a trigger on the board's chrome, and a
 * rail that says who is waiting and for how long.
 *
 * Read RENDERED and DRIVEN, not as source text. Every claim below is one a
 * reader can falsify in ten seconds with a mouse: the count is visible with the
 * rail shut, the legend explains the three age cells, Escape closes this and
 * nothing else, `q` is inert while typing, and a read that failed offers a retry
 * instead of an empty panel.
 *
 * The four age/attribution rules themselves are `tests/review-queue.test.mjs`;
 * this file is about what reaches the screen.
 */

const DAY = 86_400_000;
// Fixtures hang off the real clock, because the cells are read against it: an
// absolute date would make this file say "81d" a couple of months from now.
const T = Date.now();
const [PRODUCT_GATE, DESIGN_GATE, TECH_GATE, CODE_GATE] = REVIEW_QUEUE_GATES.map((gate) => gate.id);

function card(id, stage, overrides = {}) {
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

function readEvent(cardId, kind, occurredAt, overrides = {}) {
  return { cardId, kind, occurredAt, readAt: null, resolvedAt: null, archivedAt: null, ...overrides };
}

/** A stub rpc that records every call, so "one read" is assertable. */
function stubRpc(notifications, options = {}) {
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
function reset() {
  cleanup();
  window.localStorage.clear();
}

const rail = () => document.getElementById(REVIEW_QUEUE_RAIL_ID);
const trigger = () => document.getElementById(REVIEW_QUEUE_TRIGGER_ID);
const rows = () => Array.from(document.querySelectorAll("[data-review-queue-row]"));
const rowCell = (index) => rows()[index].querySelectorAll("span")[2].textContent;

const openCards = [
  card("old_card", PRODUCT_GATE, { updatedAt: T - 6 * DAY }),
  card("mid_card", DESIGN_GATE, { updatedAt: T - 2 * DAY }),
  card("new_card", CODE_GATE, { updatedAt: T - 1 }),
  card("blank_card", TECH_GATE, { updatedAt: T - 2 }),
];
const openLedger = [
  // An unread review request dates the wait exactly.
  readEvent("old_card", "completed", T - 6 * DAY),
  // Already read, so the wait's own start is not in the data: the row keeps an
  // honest bound instead of a number.
  readEvent("mid_card", "completed", T - 2 * DAY, { readAt: T - 2 * DAY + 1 }),
];

// --- 1. The reading is on the board while the rail is shut -----------------
{
  window.localStorage.clear();
  const rpc = stubRpc(openLedger);
  render(h(ReviewQueue, { rpc, cards: openCards, onOpenCard: () => {} }));
  await waitFor(() => assert.match(trigger().textContent, /4 · 6d/));
  assert.equal(trigger().getAttribute("aria-expanded"), "false", "the trigger says the rail is shut");
  assert.equal(trigger().getAttribute("aria-controls"), REVIEW_QUEUE_RAIL_ID, "and names what it opens");
  assert.equal(
    document.querySelector("[data-review-queue-badge]").textContent,
    "4 · 6d",
    "count · oldest wait, visible without opening anything",
  );
  assert.equal(rail(), null, "the rail is not mounted until it is asked for");
  assert.equal(rpc.calls.length, 1, "the ledger is read once, not once per gate");
  assert.deepEqual(rpc.calls[0], { name: "listNotifications", input: { includeArchived: false } });
  reset();
}

// --- 2. Opening: pointer, and the rail is not a modal ---------------------
{
  const rpc = stubRpc(openLedger);
  render(h(ReviewQueue, { rpc, cards: openCards, onOpenCard: () => {} }));
  await waitFor(() => assert.match(trigger().textContent, /4 · 6d/));
  fireEvent.click(trigger());
  assert.ok(rail(), "a click opens the rail");
  assert.equal(trigger().getAttribute("aria-expanded"), "true", "and the trigger reports it");
  reset();
}

// The rail is a region, not a dialog: no `aria-modal`, no backdrop, and the
// board behind it stays operable. A dialog here would trap focus in a surface
// whose whole point is that you can keep working beside it.
{
  const rpc = stubRpc(openLedger);
  render(h(ReviewQueue, { rpc, cards: openCards, onOpenCard: () => {} }));
  await waitFor(() => assert.match(trigger().textContent, /4 · 6d/));
  fireEvent.click(trigger());
  assert.equal(rail().getAttribute("role"), "region", "the rail is a region");
  assert.equal(rail().getAttribute("aria-label"), "Review queue");
  assert.equal(rail().hasAttribute("aria-modal"), false, "and not a modal: no aria-modal");
  assert.equal(document.querySelector("[data-persistent-drawer-content]"), null, "no drawer shell wraps it");
  assert.equal(
    document.querySelectorAll("[data-review-queue-rail]").length,
    1,
    "one rail, so there is no second copy to disagree with",
  );
  reset();
}

// --- 3. The legend is there without being asked ---------------------------
{
  const rpc = stubRpc([]);
  render(h(ReviewQueue, { rpc, cards: [], onOpenCard: () => {} }));
  await waitFor(() => assert.equal(trigger().getAttribute("aria-label"), "Review queue: 0"));
  fireEvent.click(trigger());
  const legend = document.querySelector("[data-review-queue-legend]");
  assert.ok(legend, "the legend renders with the rail");
  assert.ok(legend.textContent.includes("4d"), "the exact cell is explained");
  assert.ok(legend.textContent.includes("~4d"), "the derived cell is explained");
  assert.ok(legend.textContent.includes("\u2014"), "the unknown cell is explained");
  assert.ok(
    document.querySelector("[data-review-queue-empty]"),
    "an empty queue says so in words rather than being a blank panel",
  );
  assert.equal(trigger().getAttribute("aria-label"), "Review queue: 0", "and the badge reads 0, not a dash");
  reset();
}

// --- 4. Row anatomy: name, gate, age — in oldest-first order --------------
{
  const rpc = stubRpc(openLedger);
  render(h(ReviewQueue, { rpc, cards: openCards, onOpenCard: () => {} }));
  await waitFor(() => assert.match(trigger().textContent, /4 · 6d/));
  fireEvent.click(trigger());
  assert.equal(rows().length, 4, "every gate card is reported, including the one with no record");
  assert.deepEqual(
    rows().map((row) => row.querySelector("span").textContent),
    ["Card old_card", "Card mid_card", "Card new_card", "Card blank_card"],
    "oldest wait first, unmeasured last",
  );
  assert.deepEqual(
    rows().map((_, index) => rowCell(index)),
    ["6d", "~2d", "\u2014", "\u2014"],
    "the exact age, the derived age and two blanks — the three age states, all rendered",
  );
  assert.equal(rows()[0].querySelectorAll("span").length, 3, "name, gate and age: the whole row");
  assert.ok(rows()[0].getAttribute("aria-label").includes("Product Review"), "the row names its gate for a screen reader");
  reset();
}

// --- 5. Keyboard: one tab stop, arrows inside, Enter opens ----------------
{
  const opened = [];
  const rpc = stubRpc(openLedger);
  render(h(ReviewQueue, { rpc, cards: openCards, onOpenCard: (id) => opened.push(id) }));
  await waitFor(() => assert.match(trigger().textContent, /4 · 6d/));
  fireEvent.click(trigger());
  assert.deepEqual(rows().map((row) => row.tabIndex), [0, -1, -1, -1], "the list is one tab stop");
  fireEvent.keyDown(rows()[0], { key: "ArrowDown" });
  assert.equal(document.activeElement, rows()[1], "ArrowDown moves into the list");
  assert.deepEqual(rows().map((row) => row.tabIndex), [-1, 0, -1, -1], "and the tab stop moves with the focus");
  fireEvent.keyDown(rows()[1], { key: "End" });
  assert.equal(document.activeElement, rows()[3], "End jumps to the last row");
  fireEvent.keyDown(rows()[3], { key: "Home" });
  assert.equal(document.activeElement, rows()[0], "Home comes back");
  fireEvent.keyDown(rows()[0], { key: "ArrowUp" });
  assert.equal(document.activeElement, rows()[0], "the list does not wrap past its first row");
  fireEvent.click(rows()[0]);
  assert.deepEqual(opened, ["old_card"], "a row opens its card");
  assert.equal(rail(), null, "and the rail gets out of the way");
  reset();
}

// --- 6. Escape closes this and nothing else -------------------------------
{
  const rpc = stubRpc(openLedger);
  render(h(ReviewQueue, { rpc, cards: openCards, onOpenCard: () => {} }));
  await waitFor(() => assert.match(trigger().textContent, /4 · 6d/));
  fireEvent.click(trigger());
  fireEvent.keyDown(document.body, { key: "Escape" });
  assert.ok(rail(), "Escape with focus outside the rail is not the rail's to take: the board owns that one");
  fireEvent.click(rows()[0]);
  fireEvent.click(trigger());
  fireEvent.keyDown(rows()[0], { key: "Escape" });
  assert.equal(rail(), null, "Escape from inside the rail closes it");
  assert.equal(document.activeElement, trigger(), "and focus goes back to the trigger, not to <body>");
  reset();
}

// --- 7. `q` opens and closes, and is inert while typing -------------------
{
  const rpc = stubRpc(openLedger);
  render(h(ReviewQueue, { rpc, cards: openCards, onOpenCard: () => {} }));
  await waitFor(() => assert.match(trigger().textContent, /4 · 6d/));
  fireEvent.keyDown(document.body, { key: "q" });
  assert.ok(rail(), "q opens the queue from the board");
  fireEvent.keyDown(document.body, { key: "q" });
  assert.equal(rail(), null, "and the same key closes it");
  const input = document.createElement("input");
  const textarea = document.createElement("textarea");
  const editable = document.createElement("div");
  editable.setAttribute("contenteditable", "true");
  document.body.append(input, textarea, editable);
  for (const element of [input, textarea, editable]) {
    fireEvent.keyDown(element, { key: "q" });
    assert.equal(rail(), null, `q typed into <${element.tagName.toLowerCase()}> must not steal the letter`);
  }
  input.remove();
  textarea.remove();
  editable.remove();
  reset();
}

// --- 8. A failed read: rows stay, the count becomes a dash, a retry exists --
{
  let fail = true;
  const rpc = stubRpc(openLedger, { fail: () => fail });
  render(h(ReviewQueue, { rpc, cards: openCards, onOpenCard: () => {} }));
  await waitFor(() => assert.equal(trigger().getAttribute("aria-label"), "Review queue: \u2014"));
  assert.equal(
    document.querySelector("[data-review-queue-badge]").textContent,
    "\u2014",
    "a read that failed is a dash, never 0",
  );
  fireEvent.click(trigger());
  assert.equal(rows().length, 4, "the gate cards are still reported: a failed read is not an empty board");
  assert.equal(document.querySelector("[data-review-queue-empty]"), null, "and nothing claims the queue is empty");
  const failures = Array.from(document.querySelectorAll("[data-review-queue-failure]"));
  assert.deepEqual(
    failures.map((node) => node.getAttribute("data-review-queue-failure")),
    [PRODUCT_GATE, DESIGN_GATE, TECH_GATE, CODE_GATE],
    "each gate that could not be read says so by name",
  );
  for (const failure of failures) {
    assert.match(failure.textContent, /could not check .+Review/, "in words a reader can act on");
    assert.ok(failure.querySelector("button"), "with its own retry");
  }
  const before = rpc.calls.length;
  fail = false;
  fireEvent.click(failures[3].querySelector("button"));
  await waitFor(() => assert.equal(trigger().getAttribute("aria-label"), "Review queue: 4 · 6d"));
  assert.equal(rpc.calls.length, before + 1, "a retry re-issues the one read, once");
  assert.deepEqual(rpc.calls.at(-1), { name: "listNotifications", input: { includeArchived: false } });
  assert.equal(document.querySelectorAll("[data-review-queue-failure]").length, 0, "and the failures clear");
  assert.deepEqual(
    rows().map((_, index) => rowCell(index)),
    ["6d", "~2d", "\u2014", "\u2014"],
    "the ages come back with the read",
  );
  reset();
}

// --- 9. Reading the ledger is not a poll ----------------------------------
//
// The ages move on the clock, not on a fetch: a rail left open for an hour must
// not have issued 120 reads. The interval is shorter than a person waits for the
// cell to change unit, and it does not re-read.
{
  const rpc = stubRpc(openLedger);
  render(h(ReviewQueue, { rpc, cards: openCards, onOpenCard: () => {} }));
  await waitFor(() => assert.match(trigger().textContent, /4 · 6d/));
  assert.ok(REVIEW_QUEUE_TICK_MS <= 60_000, "the age tick is under a minute");
  assert.equal(rpc.calls.length, 1, "and it is the only read so far");
  reset();
}

// --- 10. It reopens where the reader left it ------------------------------
//
// Open state is a preference, not a navigation fact: somebody who works with the
// queue open all day should not reopen it on every panel switch. The stored
// value is read through a guard, so a browser that blocks storage gets the shut
// default instead of an exception.
{
  reset();
  const rpc = stubRpc(openLedger);
  render(h(ReviewQueue, { rpc, cards: openCards, onOpenCard: () => {} }));
  await waitFor(() => assert.equal(trigger().getAttribute("aria-expanded"), "false"));
  fireEvent.click(trigger());
  assert.ok(rail(), "opened");
  cleanup();
  render(h(ReviewQueue, { rpc, cards: openCards, onOpenCard: () => {} }));
  await waitFor(() => assert.equal(trigger().getAttribute("aria-expanded"), "true"));
  assert.ok(rail(), "and it comes back open, because the reader left it open");
  reset();
}

// --- 11. A browser that blocks storage still gets a working panel ---------
{
  reset();
  const original = Object.getOwnPropertyDescriptor(window, "localStorage");
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    get() {
      throw new Error("storage is blocked");
    },
  });
  const rpc = stubRpc(openLedger);
  render(h(ReviewQueue, { rpc, cards: openCards, onOpenCard: () => {} }));
  await waitFor(() => assert.match(trigger().textContent, /4 · 6d/));
  fireEvent.click(trigger());
  assert.ok(rail(), "the queue opens without its preference being persisted");
  if (original) Object.defineProperty(window, "localStorage", original);
  reset();
}

console.log("review queue rail test ok");

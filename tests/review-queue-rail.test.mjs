import assert from "node:assert/strict";
// The host runtime must exist before any component imports the plugin SDK.
import "./helpers/bb-runtime-stub.mjs";
import { createElement as h } from "react";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import {
  REVIEW_QUEUE_RAIL_ID,
  REVIEW_QUEUE_TRIGGER_ID,
  ReviewQueue,
} from "../components/board/review-queue.tsx";
import { REVIEW_QUEUE_TICK_MS } from "../lib/review-queue.mjs";
import {
  CODE_GATE,
  DESIGN_GATE,
  PRODUCT_GATE,
  TECH_GATE,
  openCards,
  openLedger,
  reset,
  stubRpc,
} from "./helpers/review-queue-fixture.mjs";

/**
 * The review queue as a reading: a trigger on the board's chrome, and a rail that
 * says who is waiting and for how long.
 *
 * Read RENDERED, not as source text. Every claim below is one a reader can
 * falsify in ten seconds with a mouse: the count is visible with the rail shut,
 * the legend explains the three age cells, a failed read offers a retry instead
 * of an empty panel, and a read still in flight says it is checking rather than
 * announcing four failures. What the keyboard does is
 * `tests/review-queue-keys.test.mjs`; the four age/attribution rules themselves
 * are `tests/review-queue.test.mjs`.
 */

const rail = () => document.getElementById(REVIEW_QUEUE_RAIL_ID);
const trigger = () => document.getElementById(REVIEW_QUEUE_TRIGGER_ID);
const rows = () => Array.from(document.querySelectorAll("[data-review-queue-row]"));
const rowCell = (index) => rows()[index].querySelectorAll("span")[2].textContent;

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
  assert.match(legend.textContent, /6h/, "the exact cell is explained in the hour unit the cells use");
  assert.match(legend.textContent, /3d/, "and in the day unit, so both shapes are taught");
  assert.ok(legend.textContent.includes("~6h"), "the bound is explained with its marker");
  assert.ok(legend.textContent.includes("\u2014"), "the unknown cell is explained");
  // F9: a bound must say that it starts at the card's own record, because that
  // is what makes it a bound rather than a creation date it cannot see.
  assert.match(
    legend.textContent,
    /card's own record/i,
    "the bound's explanation names the record it is read from",
  );
  assert.doesNotMatch(
    legend.textContent,
    /creation|created/i,
    "and does not claim a creation time the projection cannot see",
  );
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
    ["Card old_card", "Card stalled_card", "Card read_card", "Card new_card"],
    "oldest wait first, unmeasured last",
  );
  assert.deepEqual(
    rows().map((_, index) => rowCell(index)),
    ["6d", "~3d", "2d", "\u2014"],
    "the exact age, the derived age and two blanks — the three age states, all rendered",
  );
  assert.equal(rows()[0].querySelectorAll("span").length, 3, "name, gate and age: the whole row");
  assert.ok(rows()[0].getAttribute("aria-label").includes("Product Review"), "the row names its gate for a screen reader");
  assert.ok(
    document.querySelector("[data-review-queue-legend]"),
    "the legend stays visible with four rows in the queue, not only when the queue is empty",
  );
  assert.deepEqual(
    rows().map((row) => row.getAttribute("data-waiting-on")),
    ["human", "unattributed", "human", "unattributed"],
    "every row carries the attribution it was counted by, so the diff can be read",
  );
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
    ["6d", "~3d", "2d", "\u2014"],
    "the ages come back with the read",
  );
  reset();
}

// --- 9. The ages move on the clock, and the clock is not a fetch -----------
//
// A rail left open for an hour must not have issued 120 reads. This harness has
// no fake-timer seam, so what is asserted is what it can see: the tick constant
// is under a minute, and mounting issues one read rather than one per gate. The
// interval itself only sets `nowMs`.
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

// --- 12. A read still in flight is `checking`, not four failures ----------
//
// The defect this replaced: `ledgerOk` was false before the first read came
// back, so every board load announced four failed gate reads and offered a
// retry that could not run — a button that lies, on the state a reader sees
// most often.
{
  reset();
  let calls = 0;
  const stalled = {
    call: () => {
      calls += 1;
      return new Promise(() => {});
    },
  };
  render(h(ReviewQueue, { rpc: stalled, cards: openCards, onOpenCard: () => {} }));
  await waitFor(() => assert.equal(calls, 1, "the panel issues its one read on mount"));
  assert.equal(
    document.querySelector("[data-review-queue-badge]").textContent,
    "\u2014",
    "the count is a dash while the read is in flight: it is unknown, not zero",
  );
  fireEvent.click(trigger());
  assert.ok(document.querySelector("[data-review-queue-checking]"), "the rail says it is checking");
  assert.equal(
    document.querySelectorAll("[data-review-queue-failure]").length,
    0,
    "and nothing has failed yet, so nothing claims it has",
  );
  assert.equal(
    Array.from(document.querySelectorAll("button")).filter((node) => /retry/i.test(node.textContent)).length,
    0,
    "no retry is offered for a read that is still running",
  );
  assert.equal(rows().length, 0, "and no row is rendered from a read that has not answered");
  assert.equal(document.querySelector("[data-review-queue-empty]"), null, "least of all an empty-queue claim");
  reset();
}

// --- 14. The door presents the button, and does not claim what it cannot read
//
// C1: the affordance copy presents the button, not the chord. And the phrase
// "waiting on you" was printed beside a dash badge, i.e. beside a reading that
// says nothing is known.
{
  reset();
  const rpc = stubRpc(openLedger);
  render(h(ReviewQueue, { rpc, cards: openCards, onOpenCard: () => {} }));
  await waitFor(() => assert.match(trigger().textContent, /4 · 6d/));
  assert.doesNotMatch(trigger().textContent, /\bq\b/, "the visible copy does not teach the chord");
  assert.match(trigger().textContent, /waiting on you/, "it says what the number means while the read is good");
  fireEvent.click(trigger());
  assert.doesNotMatch(trigger().textContent, /\bq\b/, "nor when the rail is open");
  reset();

  const broken = stubRpc(openLedger, { fail: () => true });
  render(h(ReviewQueue, { rpc: broken, cards: openCards, onOpenCard: () => {} }));
  await waitFor(() => assert.equal(trigger().getAttribute("aria-label"), "Review queue: \u2014"));
  assert.doesNotMatch(
    trigger().textContent,
    /waiting on you/,
    "and it does not say a card is waiting while the badge is a dash",
  );
  reset();
}
console.log("review queue rail test ok");

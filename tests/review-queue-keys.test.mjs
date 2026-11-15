import assert from "node:assert/strict";
// The host runtime must exist before any component imports the plugin SDK.
import "./helpers/bb-runtime-stub.mjs";
import { createElement as h } from "react";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { REVIEW_QUEUE_RAIL_ID, ReviewQueue } from "../components/board/review-queue.tsx";
import {
  openCards,
  openLedger,
  reset,
  stubRpc,
} from "./helpers/review-queue-fixture.mjs";

/**
 * The review queue's keyboard: one tab stop, arrows inside, Escape scoped to the
 * panel, `q` inert while typing, and where focus lands on open.
 *
 * Split from `tests/review-queue-rail.test.mjs` (what reaches the screen) because
 * a 450-line test is a test nobody reads. Rendered and driven, never source-pinned.
 */

const rail = () => document.getElementById(REVIEW_QUEUE_RAIL_ID);
const trigger = () => document.getElementById("review-queue-trigger");
const rows = () => Array.from(document.querySelectorAll("[data-review-queue-row]"));

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
  assert.equal(rows()[0].tagName, "BUTTON", "a row is a native button, so Enter and Space activate it");
  assert.equal(rows()[0].getAttribute("type"), "button", "and it submits nothing");
  assert.equal(
    fireEvent.keyDown(rows()[0], { key: "Enter" }),
    true,
    "Enter is not intercepted: the browser's own activation is what opens the card",
  );
  fireEvent.click(rows()[0]);
  assert.deepEqual(opened, ["old_card"], "a row opens its card");
  assert.ok(rail(), "and the rail stays up: closing it would drop the reader back on the board after every card");
  assert.equal(document.activeElement, rows()[0], "with focus still on that row, so the next card is one arrow away");
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
  const select = document.createElement("select");
  const editable = document.createElement("div");
  editable.setAttribute("contenteditable", "true");
  document.body.append(input, textarea, select, editable);
  for (const element of [input, textarea, select, editable]) {
    fireEvent.keyDown(element, { key: "q" });
    assert.equal(rail(), null, `q typed into <${element.tagName.toLowerCase()}> must not steal the letter`);
  }
  input.remove();
  textarea.remove();
  select.remove();
  editable.remove();
  reset();
}

// --- 13. Opening puts the reader in the panel, not on the board -----------
//
// The design's wiring: "open panel, focus lands on oldest row". Without it the
// arrows do nothing until the reader Tabs in, and Escape is not yet theirs.
{
  reset();
  const rpc = stubRpc(openLedger);
  render(h(ReviewQueue, { rpc, cards: openCards, onOpenCard: () => {} }));
  await waitFor(() => assert.match(trigger().textContent, /4 · 6d/));
  fireEvent.click(trigger());
  assert.equal(document.activeElement, rows()[0], "a pointer open lands on the oldest row");
  fireEvent.keyDown(document.activeElement, { key: "ArrowDown" });
  assert.equal(document.activeElement, rows()[1], "so the arrows work immediately");
  reset();

  const second = stubRpc(openLedger);
  render(h(ReviewQueue, { rpc: second, cards: openCards, onOpenCard: () => {} }));
  await waitFor(() => assert.match(trigger().textContent, /4 · 6d/));
  fireEvent.keyDown(document.body, { key: "q" });
  assert.ok(rail(), "q still opens the queue");
  assert.equal(document.activeElement, rows()[0], "and the keyboard open lands there too, not on the board");
  reset();
}
console.log("review queue keys test ok");

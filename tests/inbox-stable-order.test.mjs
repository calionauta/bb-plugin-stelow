import assert from "node:assert/strict";
import test from "node:test";
import { stableInboxOrder } from "../lib/inbox-stable-order.mjs";

/**
 * The Inbox list's order, held still while the reader is looking at it.
 *
 * What regresses if these fail: a severity bump reorders the list under an open
 * hand, so a click aimed at "Mark as read" lands on the row that just pushed it
 * down. Every row on that list carries actions.
 */

const row = (id) => ({ id });

test("with no previous order the reader gets the natural one", () => {
  assert.deepEqual(stableInboxOrder(null, [row("a"), row("b")]), { order: ["a", "b"], held: 0 });
  assert.deepEqual(stableInboxOrder([], [row("a")]), { order: ["a"], held: 0 });
});

test("a row that gains severity keeps its place", () => {
  // b was third and would be first; the reader is looking at a.
  const held = stableInboxOrder(["a", "b", "c"], [row("b"), row("a"), row("c")]);
  assert.deepEqual(held.order, ["a", "b", "c"]);
  // Both rows of the swap are out of the order they belong in, and the control
  // counts the rows, not the event.
  assert.equal(held.held, 2);
});

test("an arriving row joins the end instead of pushing the rest down", () => {
  const held = stableInboxOrder(["a", "b"], [row("new"), row("a"), row("b")]);
  assert.deepEqual(held.order, ["a", "b", "new"]);
  assert.equal(held.held, 1);
});

test("a row that left stays gone", () => {
  // Resolved, archived, or filtered out elsewhere: a stale snapshot must not
  // resurrect a row that is no longer in the list.
  const held = stableInboxOrder(["a", "gone", "b"], [row("a"), row("b")]);
  assert.deepEqual(held.order, ["a", "b"]);
});

test("Show adopts the natural order and the next read is quiet", () => {
  const natural = [row("b"), row("a"), row("c")];
  // Pressing Show freezes the list as it now stands, which is the natural order.
  const shown = stableInboxOrder(null, natural);
  assert.deepEqual(shown.order, ["b", "a", "c"]);
  assert.equal(shown.held, 0);
  // Re-drawing the same list against that order has nothing to report.
  assert.deepEqual(stableInboxOrder(shown.order, natural), { order: ["b", "a", "c"], held: 0 });
});

test("an unchanged list reports nothing", () => {
  const entries = [row("a"), row("b")];
  assert.deepEqual(stableInboxOrder(["a", "b"], entries), { order: ["a", "b"], held: 0 });
});

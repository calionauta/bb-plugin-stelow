import assert from "node:assert/strict";
import test from "node:test";
import { nextOrderState, showRequested } from "../lib/inbox-order-state.mjs";
import { stableInboxOrder } from "../lib/inbox-stable-order.mjs";

/**
 * Which order is frozen, and when it stops being frozen.
 *
 * `lib/inbox-stable-order` answers "where do these rows go"; this answers "which
 * order is held". Both halves of the hold had no test — the only suite imported
 * the ordering fold, so deleting Show or the filter reset failed nothing, and
 * those are the two behaviours `FEATURES.md` advertises. What regresses if these
 * fail: the list stops holding (rows move under a click), or it never lets go
 * (a filter change reports every row as an update, and Show does nothing).
 */

const ATTENTION = "attention:false";

test("the first draw of a list fixes the order it will keep", () => {
  const state = nextOrderState(null, ["a", "b"], ATTENTION);
  assert.deepEqual(state, { viewKey: ATTENTION, frozen: ["a", "b"] });
});

test("a realtime reshuffle does not move the frozen order", () => {
  const first = nextOrderState(null, ["a", "b"], ATTENTION);
  const next = nextOrderState(first, ["b", "a"], ATTENTION);
  // Same object: React bails out instead of re-rendering the list on every tick.
  assert.equal(next, first);
  assert.deepEqual(stableInboxOrder(next.frozen, [{ id: "a" }, { id: "b" }]).order, ["a", "b"]);
});

test("an arriving row joins the frozen order at the end", () => {
  const first = nextOrderState(null, ["a", "b"], ATTENTION);
  const next = nextOrderState(first, ["new", "a", "b"], ATTENTION);
  assert.equal(next, first, "the snapshot does not change");
  const view = stableInboxOrder(next.frozen, [{ id: "new" }, { id: "a" }, { id: "b" }]);
  assert.deepEqual(view.order, ["a", "b", "new"]);
  assert.equal(view.held, 1, "and the control that says so counts it");
});

test("a different list adopts its own order at once", () => {
  // A filter change is a list the reader asked for. Without this, switching tabs
  // reads as "everything arrived" and every row is an update.
  const first = nextOrderState(null, ["a", "b"], ATTENTION);
  const next = nextOrderState(first, ["c", "d"], "unread:true");
  assert.deepEqual(next, { viewKey: "unread:true", frozen: ["c", "d"] });
  assert.notEqual(next, first);
});

test("Show adopts the order as it stands now", () => {
  const first = nextOrderState(null, ["a", "b"], ATTENTION);
  const before = stableInboxOrder(first.frozen, [{ id: "b" }, { id: "a" }]);
  assert.deepEqual(before.order, ["a", "b"]);
  assert.equal(before.held, 2, "two rows are out of place, so the control offers Show");

  const shown = showRequested(first, ["b", "a"]);
  const after = stableInboxOrder(shown.frozen, [{ id: "b" }, { id: "a" }]);
  assert.deepEqual(after.order, ["b", "a"]);
  assert.equal(after.held, 0, "and the control goes away");
});

test("Show is idempotent and keeps the same list", () => {
  const first = nextOrderState(null, ["a"], ATTENTION);
  const shown = showRequested(first, ["a", "b"]);
  assert.equal(shown.viewKey, ATTENTION);
  assert.deepEqual(shown.frozen, ["a", "b"]);
  // Pressing Show again, or a tick arriving after it, changes nothing.
  assert.equal(nextOrderState(shown, ["a", "b"], ATTENTION), shown);
  assert.deepEqual(showRequested(shown, ["a", "b"]), shown);
});

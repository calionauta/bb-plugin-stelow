import assert from "node:assert/strict";
import { STATUS_RANK, orderScopes, statusRank } from "../lib/scope-order.mjs";

// Ranks: active first, committed next, blocked, finished last; unknown parks mid-list.
assert.equal(statusRank("in-progress"), 0, "active sorts first");
assert.equal(statusRank("draft"), 1, "draft is committed");
assert.equal(statusRank("blocked"), 2, "blocked waits");
assert.equal(statusRank("done"), 4, "done sorts last");
assert.equal(statusRank("completed"), 4, "completed sorts last");
assert.equal(statusRank("bogus"), 3, "unknown parks mid-list");
assert.equal(statusRank(null), 3, "junk parks mid-list, never throws");
assert.equal(STATUS_RANK["failed"], 2, "failed waits with blocked");

// Order: dependencies precede, ties keep file order (deterministic).
const linear = [
  { id: "b", status: "pending", dependsOn: ["a"] },
  { id: "a", status: "pending" },
  { id: "c", status: "pending", blockedBy: ["b"] },
];
const ranked = orderScopes(linear);
assert.deepEqual(ranked.ordered.map((s) => s.id), ["a", "b", "c"], "dependencies precede, ties keep order");
assert.deepEqual(ranked.waitingOn.get("b"), ["a"], "unfinished deps are waited on");
assert.deepEqual(ranked.waitingOn.get("c"), ["b"], "blockers are waited on");
// Finished deps need no waiting and impose no order.
const withDone = orderScopes([
  { id: "x", status: "pending", dependsOn: ["done-dep"] },
  { id: "done-dep", status: "done" },
]);
assert.deepEqual(withDone.ordered.map((s) => s.id), ["x", "done-dep"], "finished deps impose no order");
assert.equal(withDone.waitingOn.has("x"), false, "finished deps are never waited on");
// Missing dep ids are ignored (not waited on, never crash).
const missing = orderScopes([{ id: "m", status: "pending", dependsOn: ["ghost"] }]);
assert.deepEqual(missing.ordered.map((s) => s.id), ["m"], "missing deps do not block");
assert.equal(missing.waitingOn.has("m"), false, "missing deps are never waited on");
// Cycles keep original position instead of hanging.
const cyclic = orderScopes([
  { id: "p", status: "pending", dependsOn: ["q"] },
  { id: "q", status: "pending", dependsOn: ["p"] },
]);
assert.deepEqual(cyclic.ordered.map((s) => s.id).sort(), ["p", "q"], "cycles resolve without hanging");
// Junk degrades to empty, never throws.
assert.deepEqual(orderScopes(null), { ordered: [], waitingOn: new Map() }, "junk orders to empty");
assert.deepEqual(orderScopes("nope"), { ordered: [], waitingOn: new Map() }, "non-arrays order to empty");

console.log("scope order test ok: ranks, dependencies, waiting, cycles, fail-soft");

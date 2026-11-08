import assert from "node:assert/strict";
import { resolveLive } from "../lib/decision-lineage.mjs";

const a = { id: "r-a", scopeIds: ["s1"], selectedId: "opt-5", rejectedOptionIds: ["opt-3"] };
const b = { id: "r-b", scopeIds: ["s1"], selectedId: "opt-3", supersedes: ["r-a"] };

// A superseding decision retires the old one by name.
const chained = resolveLive([a, b]);
assert.deepEqual(chained.live.map((r) => r.id), ["r-b"]);
assert.deepEqual(chained.superseded.map((r) => r.id), ["r-a"]);
assert.deepEqual(chained.conflicts, []);

// `supersededBy` pointing at a known receipt also retires.
const back = resolveLive([{ ...a, supersededBy: "r-b" }, b]);
assert.deepEqual(back.live.map((r) => r.id), ["r-b"]);

// Two live receipts contradicting on overlapping scopes surface as conflict.
const c = { id: "r-c", scopeIds: ["s1"], selectedId: "opt-9" };
const conflicted = resolveLive([a, c]);
assert.equal(conflicted.conflicts.length, 1);
assert.deepEqual(conflicted.conflicts[0], { a: "r-a", b: "r-c", scopeIds: ["s1"] });

// Same selection on overlapping scopes is not a conflict; disjoint scopes never are.
assert.deepEqual(resolveLive([a, { ...c, selectedId: "opt-5" }]).conflicts, []);
assert.deepEqual(resolveLive([a, { ...c, scopeIds: ["s2"] }]).conflicts, []);

// Legacy receipts without chain fields stay live.
assert.deepEqual(resolveLive([{ id: "r-old" }]).live.map((r) => r.id), ["r-old"]);

console.log("decision-lineage: ok");

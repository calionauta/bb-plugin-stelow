import assert from "node:assert/strict";
import { capReads, formatDecisionReads, receiptsForScopes } from "../lib/decision-coverage.mjs";

const a = { id: "r-a", kind: "selection", scopeIds: ["s1"] };
const b = { id: "r-b", kind: "selection", scopeIds: ["s2"] };
const legacy = { id: "r-legacy", kind: "selection" };

// Coverage selects by overlap; legacy receipts without scopeIds cover all.
assert.deepEqual(receiptsForScopes([a, b, legacy], ["s1"]).map((r) => r.id), ["r-a", "r-legacy"]);
assert.deepEqual(receiptsForScopes([a, b], ["s9"]).map((r) => r.id), []);
assert.deepEqual(receiptsForScopes([a, b], []).map((r) => r.id), ["r-a", "r-b"]);
assert.deepEqual(receiptsForScopes([], ["s1"]), []);
assert.deepEqual(receiptsForScopes([a, null, { kind: "x" }], ["s1"]).map((r) => r.id), ["r-a"]);

// Cap keeps order and names the omitted.
const five = ["1", "2", "3", "4", "5", "6"].map((n) => ({ id: `r-${n}`, scopeIds: ["s1"] }));
const capped = capReads(five, 5);
assert.equal(capped.served.length, 5);
assert.deepEqual(capped.omittedIds, ["r-6"]);
assert.deepEqual(capReads([a], 5), { served: [a], omittedIds: [] });

// Formatting: empty stays empty (callers stay additive); truncation is named.
assert.equal(formatDecisionReads([], []), "");
assert.match(formatDecisionReads([a], []), /r-a/);
assert.match(formatDecisionReads(capped.served, capped.omittedIds), /r-6/);

console.log("decision-coverage: ok");

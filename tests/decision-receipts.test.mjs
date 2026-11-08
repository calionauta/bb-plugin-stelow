import assert from "node:assert/strict";
import {
  buildChallenge,
  buildDecisionReceipt,
  parseChallenge,
  parseReceipt,
  parseReceiptFile,
  parseReceiptStore,
  serializeReceiptFile,
  validateDecisionReceipt,
} from "../lib/decision-receipts.mjs";

// A full build carries winner, losers, scopes, versions, and attribution.
const built = buildDecisionReceipt(
  { selectedId: "opt-5", rejectedOptionIds: ["opt-3"], scopeIds: ["s1"], reason: "cheaper to run" },
  { id: "r-1", shapeVersion: "v3" },
);
assert.equal(built.ok, true);
assert.equal(built.receipt.selectedId, "opt-5");
assert.deepEqual(built.receipt.rejectedOptionIds, ["opt-3"]);
assert.deepEqual(built.receipt.authorizesVersions, { shape_version: "v3" });
assert.equal(built.receipt.approvedBy, "operator");

// Fail-closed: no winner, winner-also-rejected, bad ids, no host id.
assert.equal(buildDecisionReceipt({}, { id: "r-1" }).ok, false);
assert.equal(buildDecisionReceipt({ selectedId: "a", rejectedOptionIds: ["a"] }, { id: "r-1" }).ok, false);
assert.equal(buildDecisionReceipt({ selectedId: "a", scopeIds: ["bad id!"] }, { id: "r-1" }).ok, false);
assert.equal(buildDecisionReceipt({ selectedId: "a" }, { id: "" }).ok, false);

// Comma strings and duplicates normalize; supersedes chains.
const chained = buildDecisionReceipt(
  { selectedId: "opt-9", rejectedOptionIds: "opt-3, opt-3", supersedes: ["r-1"] },
  { id: "r-2" },
);
assert.equal(chained.ok, true);
assert.deepEqual(chained.receipt.rejectedOptionIds, ["opt-3"]);
assert.deepEqual(chained.receipt.supersedes, ["r-1"]);

// Round-trip: serialize then parse recovers; unknown shapes skip silently.
const file = serializeReceiptFile([built.receipt, { kind: "junk" }, null]);
const parsed = parseReceiptFile(file);
assert.equal(parsed.length, 1);
assert.equal(parsed[0].id, "r-1");
assert.deepEqual(parseReceiptFile("not json"), []);
assert.equal(parseReceipt(null), null);
assert.ok(validateDecisionReceipt({}).length > 0);

// Challenges: minted with target + reason; unknown shapes skip.
const challenge = buildChallenge({ receiptId: "r-1", reason: "cost changed" }, { id: "ch-1" });
assert.equal(challenge.ok, true);
assert.equal(challenge.challenge.receiptId, "r-1");
assert.equal(buildChallenge({ receiptId: "r-1" }, { id: "ch-2" }).ok, false);
assert.equal(buildChallenge({ reason: "x" }, { id: "ch-2" }).ok, false);
assert.equal(parseChallenge({ id: "x" }), null);

// The store round-trips receipts and challenges; corruption is reported, not thrown.
const store = parseReceiptStore(serializeReceiptFile([built.receipt], [challenge.challenge]));
assert.equal(store.receipts.length, 1);
assert.equal(store.challenges.length, 1);
assert.equal(store.corrupt, false);
assert.deepEqual(parseReceiptStore("not json"), { receipts: [], challenges: [], corrupt: true });
assert.deepEqual(parseReceiptStore(null), { receipts: [], challenges: [], corrupt: false });

console.log("decision-receipts: ok");

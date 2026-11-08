import assert from "node:assert/strict";
import { decisionReadsBlock, promptWithDecisionReads } from "../server/runtime/decision-reads.ts";

const receipts = [
  { id: "r-a", kind: "selection", scopeIds: ["s1"] },
  { id: "r-b", kind: "selection", scopeIds: ["s2"] },
];

// Only covering receipts are served, and the prompt gains them additively.
const block = decisionReadsBlock(receipts, ["s1"]);
assert.match(block, /r-a/);
assert.doesNotMatch(block, /r-b/);
assert.match(promptWithDecisionReads("base prompt", block), /base prompt[\s\S]*r-a/);

// Empty coverage stays empty, and the prompt is untouched (identity).
assert.equal(decisionReadsBlock(receipts, ["s9"]), "");
assert.equal(decisionReadsBlock([], ["s1"]), "");
assert.equal(promptWithDecisionReads("base prompt", ""), "base prompt");

console.log("decision-reads: ok");

import assert from "node:assert/strict";
import { researchOpportunityHint } from "../lib/research-opportunity-summary.mjs";

assert.equal(researchOpportunityHint(4, 4), "4 opportunities ready to build", "all opportunities are actionable");
assert.equal(researchOpportunityHint(1, 1), "1 opportunity ready to build", "singular opportunity");
assert.equal(researchOpportunityHint(3, 4), "3 opportunities ready to build · 1 build card created", "mixed fan-out state");
assert.equal(researchOpportunityHint(0, 4), "4 build cards created", "all opportunities fanned out");
assert.equal(researchOpportunityHint(0, 0), "no opportunities yet", "empty index");
assert.equal(researchOpportunityHint(-1, 2), "2 build cards created", "invalid available count is safe");

console.log("research opportunity summary tests passed");

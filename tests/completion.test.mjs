import assert from "node:assert/strict";
import { doneEligibility, doneScopeSyncRefusal } from "../lib/completion.mjs";

// Regression: done-ness was inferred from `audit` + idle, so a worker that
// narrated-and-stopped at audit was indistinguishable from one stuck at
// audit. `bb stelow done` commits completion; the host verifies in code,
// and every refusal names the fix.

assert.equal(doneEligibility({ kind: "build", stage: "audit", questionPending: false }), null, "a build at audit may complete");
assert.equal(doneEligibility({ kind: "build", stage: "audit", questionPending: false, scopesOpen: [] }), null, "no scopes is no veto — the parameter defaults the same way");
assert.match(doneEligibility({ kind: "build", stage: "audit", questionPending: false, scopesOpen: [{ id: "s1", name: "Checkout", status: "pending" }] }), /1 scope\(s\) still open/, "a pending scope blocks completion instead of certifying walked-past work");
assert.match(doneEligibility({ kind: "build", stage: "audit", questionPending: false, scopesOpen: [{ id: "s1", name: "Checkout", status: "in-progress" }] }), /Checkout \(in-progress\)/, "the refusal names the open scope and its state");
assert.equal(doneEligibility({ kind: "build", stage: "audit", questionPending: false, scopesOpen: [{ id: "s1", name: "Done work", status: "done" }, { id: "s2", name: "Dropped", status: "skipped" }] }), null, "done, completed, and explicitly skipped scopes pass");
assert.match(doneEligibility({ kind: "build", stage: "shape", questionPending: false }), /at 'shape', not 'audit'/, "a build off audit is refused with its stage");
assert.match(doneEligibility({ kind: "build", stage: null, questionPending: false }), /unknown stage/, "a build with no readable stage is refused, not completed blind");
assert.match(doneEligibility({ kind: "build", stage: "audit", questionPending: true }), /pending/, "a pending question blocks completion or it would be abandoned");
assert.equal(doneEligibility({ kind: "research", stage: null, questionPending: false }), null, "research eligibility is stage-free (verify gates artifacts)");
assert.equal(doneEligibility({ kind: "explore", stage: null, questionPending: false }), null, "explore eligibility is stage-free (verify gates artifacts)");
assert.match(doneEligibility({ kind: "research", stage: null, questionPending: true }), /pending/, "a pending question blocks research completion too");
assert.match(doneEligibility({ kind: "frobnicate", stage: null, questionPending: false }), /Archive this card/, "an unknown kind refuses with the terminal exit");

console.log("completion test ok: audit-only build, pending-question block, research/explore eligibility");

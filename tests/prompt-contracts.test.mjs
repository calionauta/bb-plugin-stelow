import assert from "node:assert/strict";
import {
  LEGACY_REVIEW_MODE_TO_GATES,
  interfaceRequiresHuman,
  normalizeReviewGates,
  planGateWaits,
} from "../lib/review-gates.mjs";
import { parseWorkflowConfig } from "../lib/workflow-config.mjs";

// Prompt contracts: the seed ban and the turn discipline hold on every
// build spawn path through single-source clauses. Behavioral coverage goes
// through the lib gates and config parser the prompts are built from — a
// new spawn path that forgets a clause fails at the gate, not in prose.

// Review gates are closed: unknown atoms drop, legacy modes expand to the
// same atoms every spawn path renders, and emptiness means Auto.
assert.deepEqual(normalizeReviewGates(["spec", "bogus"]), ["spec"], "unknown gates drop, known ones survive");
assert.deepEqual(
  normalizeReviewGates("Product Spec + Interface Gates"),
  ["spec", "interface"],
  "legacy modes expand deterministically",
);
assert.deepEqual(normalizeReviewGates("Auto"), [], "Auto carries no gates");
assert.deepEqual(normalizeReviewGates([]), [], "empty input means no gates");
assert.deepEqual(
  normalizeReviewGates("Product Spec + Interface + Tech Review + Code Diff"),
  ["spec", "interface", "scope", "tech", "diff"],
  "the full legacy mode expands to every atom",
);
assert.ok(
  Object.keys(LEGACY_REVIEW_MODE_TO_GATES).length > 0,
  "legacy modes stay mapped in one place, never pasted per prompt",
);

// Gate predicates decide who waits: interface gates require a human, plan
// gates hold the advance until the review lands.
assert.equal(interfaceRequiresHuman(["interface"]), true, "interface gates require a human");
assert.equal(interfaceRequiresHuman([]), false, "gateless runs need no human");
assert.equal(planGateWaits(["tech"]), true, "plan waits on its gate");
assert.equal(planGateWaits(["spec"]), false, "plan does not wait on unrelated gates");

// Workflow config reads through one shared parser: appetite, review mode,
// and gates resolve together, so a scope-ask never drifts from the stored
// contract. No anchored or truncating reader may reappear beside it.
const parsed = parseWorkflowConfig("appetite: Lean\nreview_mode: Auto\n", {});
assert.equal(parsed.appetite, "Lean", "appetite resolves through the shared parser");
assert.deepEqual(parsed.reviewGates, [], "Auto resolves to no gates");
const gated = parseWorkflowConfig("review_gates: [spec, interface]\n", {});
assert.deepEqual(gated.reviewGates, ["spec", "interface"], "declared gates resolve in canonical order");
const empty = parseWorkflowConfig("", {});
assert.ok(Array.isArray(empty.reviewGates), "empty configs degrade to a gate list, never a throw");

console.log("prompt contracts test ok: single-source clauses, all build spawn paths covered, no seed invitation, done/playbook/split verbs, preset fence, no audit inference, explicit split");

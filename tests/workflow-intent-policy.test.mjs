import assert from "node:assert/strict";
import { canEditWorkflowIntent, canReclassifyWorkflow, freshStatusForReseed, resolveReseedIntent } from "../lib/workflow-intent-policy.mjs";

assert.equal(canEditWorkflowIntent({ kind: "build", stage: "triage", status: "draft" }), true, "Build type is editable only during triage");
assert.equal(canEditWorkflowIntent({ kind: "build", stage: "triage", status: "archived" }), false, "an archived triage card is immutable");
assert.equal(canEditWorkflowIntent({ kind: "build", stage: "planning", status: "in-progress" }), false, "a planned Build card must reclassify instead of silently changing route");
assert.equal(canEditWorkflowIntent({ kind: "explore", stage: "explore", status: "in-progress" }), false, "Explore never has a Build workflow type");

assert.equal(canReclassifyWorkflow({ kind: "build", stage: "planning", status: "in-progress" }), true, "a started Build card can reclassify through a fresh triage run");
assert.equal(canReclassifyWorkflow({ kind: "build", stage: "triage", status: "draft" }), false, "triage uses direct editing instead of a restart");
assert.equal(canReclassifyWorkflow({ kind: "build", stage: "audit", status: "archived" }), false, "archived cards are terminal");
assert.equal(canReclassifyWorkflow({ kind: "research", stage: "research", status: "in-progress" }), false, "Research has no Build workflow type");

assert.deepEqual(resolveReseedIntent({ kind: "build", intent: "feature" }, "bugfix"), { intent: "bugfix", reclassified: true }, "reclassification carries the selected Build route into the fresh seed");
assert.deepEqual(resolveReseedIntent({ kind: "research", intent: "investigate" }), { intent: "investigate", reclassified: false }, "ordinary reseed preserves a lightweight card's own intent");
assert.equal(resolveReseedIntent({ kind: "research", intent: "investigate" }, "feature"), null, "lightweight cards cannot receive a Build route while reseeding");
assert.equal(freshStatusForReseed({ kind: "build", status: "completed" }, true), "draft", "reclassifying a completed Build card reopens it at triage");
assert.equal(freshStatusForReseed({ kind: "explore", status: "completed" }, false), "pending", "lightweight fresh runs return to their pending board state");

console.log("workflow intent policy test ok: direct edits, reclassification, and terminal cards stay distinct");

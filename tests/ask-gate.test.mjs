import assert from "node:assert/strict";
import { decideAskGate } from "../lib/ask-gate.mjs";

// The dispatcher fixes pipeline order once: duplicate, then intent, then
// evidence. Every matrix row below pins which refusal wins when several
// gates would fire, so reordering can only happen deliberately here.
const clean = {
  liveCount: 0,
  expiredCount: 0,
  kind: "build",
  intent: "feature",
  stage: "shape",
  tag: "standard",
  forced: false,
  groups: [{ question: "Proceed?", options: [{ label: "Yes", description: "go", preview: null, artifact: null }] }],
};

assert.deepEqual(decideAskGate(clean), { allowed: true, reason: null, code: 0 }, "a clean ask passes all gates");

assert.match(
  decideAskGate({ ...clean, liveCount: 2 }).reason ?? "",
  /already pending/,
  "a live form refuses before anything else is evaluated",
);
assert.equal(decideAskGate({ ...clean, liveCount: 2 }).code, 1, "duplicate is transient: retry the same ask once");
assert.match(
  decideAskGate({ ...clean, liveCount: 1, stage: "gate", groups: [{ question: "Approve?", options: [{ label: "Yes", description: "", preview: null, artifact: null }] }] }).reason ?? "",
  /already pending/,
  "duplicate wins over a simultaneous evidence violation",
);
assert.match(
  decideAskGate({ ...clean, liveCount: 1, forced: true }).reason ?? "",
  /already pending/,
  "--force never bypasses the duplicate guard",
);
assert.match(
  decideAskGate({ ...clean, expiredCount: 1 }).reason ?? "",
  /still answerable/,
  "an unanswered expired question refuses first",
);

// Intent and evidence keep their own semantics under one roof.
assert.equal(
  decideAskGate({ ...clean, tag: "split" }).allowed,
  true,
  "split mechanics route around intent and evidence gates",
);
assert.equal(
  decideAskGate({ ...clean, kind: "research" }).allowed,
  true,
  "non-build tracks pass through untouched",
);
const bareAtGate = {
  ...clean,
  stage: "gate",
  groups: [{ question: "Approve?", options: [{ label: "Yes", description: "", preview: null, artifact: null }] }],
};
assert.equal(decideAskGate(bareAtGate).allowed, false, "a gateless gate ask is refused");
assert.equal(decideAskGate(bareAtGate).code, 2, "gate refusals do not retry blindly");
assert.match(decideAskGate(bareAtGate).reason ?? "", /nothing to review/, "the evidence refusal survives the move");
assert.equal(decideAskGate({ ...bareAtGate, forced: true }).allowed, true, "--force bypasses evidence as before");

// Scope confirms carry their shape as a tag: Auto refuses (the worker
// decides), malformed shape refuses in any mode, --force bypasses both.
const scopeKeep = {
  question: "Keep IN scope?",
  multiple: true,
  options: [
    { label: "needsNaming helper", description: "predicate", preview: null, artifact: null, selected: true },
    { label: "Start-time refire", description: "burst", preview: null, artifact: null, selected: true },
  ],
};
assert.match(
  decideAskGate({ ...clean, tag: "scope-adjust", reviewMode: "Auto", groups: [scopeKeep] }).reason ?? "",
  /Auto/,
  "a scope confirm in Auto is refused with the mode named",
);
assert.equal(
  decideAskGate({ ...clean, tag: "scope-adjust", reviewMode: "Auto", groups: [scopeKeep] }).code,
  2,
  "and it does not retry blindly",
);
assert.equal(
  decideAskGate({ ...clean, reviewMode: "Auto", groups: [scopeKeep] }).allowed,
  true,
  "the mode rule is tag-scoped: untagged asks are unaffected",
);
assert.equal(
  decideAskGate({ ...clean, tag: "scope-adjust", reviewMode: "Product Spec Gate", groups: [scopeKeep] }).allowed,
  true,
  "a well-formed confirm passes in a gated mode",
);
assert.equal(
  decideAskGate({ ...clean, tag: "scope-adjust", reviewMode: "Product Spec Gate", groups: [{ ...scopeKeep, multiple: false }] }).allowed,
  false,
  "the dispatcher enforces the tagged shape, not just the lib",
);
assert.equal(
  decideAskGate({ ...clean, tag: "scope-adjust", reviewMode: "Auto", forced: true, groups: [scopeKeep] }).allowed,
  true,
  "--force bypasses the scope rule like the rest of the intent family",
);
const sevenLabels = Array.from({ length: 7 }, (_, i) => `Scope choice ${i}`);
const seven = {
  ...scopeKeep,
  options: sevenLabels.map((label) => ({ label, description: "x", preview: null, artifact: null, selected: true })),
};
assert.match(
  decideAskGate({ ...clean, tag: "scope-adjust", reviewMode: "Product Spec Gate", groups: [seven] }).reason ?? "",
  /6/,
  "the chunk ceiling holds through the dispatcher, not just the lib",
);
const unchecked = {
  ...scopeKeep,
  options: scopeKeep.options.map((option) => ({ ...option, selected: undefined })),
};
assert.match(
  decideAskGate({ ...clean, tag: "scope-adjust", reviewMode: "Product Spec Gate", groups: [unchecked] }).reason ?? "",
  /--selected/,
  "and so does the opt-out refusal",
);
assert.equal(
  decideAskGate({ ...clean, tag: "scope-adjust", reviewMode: "Auto", liveCount: 1, groups: [scopeKeep] }).code,
  1,
  "duplicate still wins over scope: a second form is a duplicate regardless of mode",
);
const stubby = {
  ...scopeKeep,
  options: [{ label: "A", description: "", preview: null, artifact: null, selected: true }],
};
assert.match(
  decideAskGate({ ...clean, tag: "scope-adjust", reviewMode: "Product Spec Gate", groups: [stubby] }).reason ?? "",
  /too short/,
  "substance runs before scope: malformed is malformed first",
);
assert.equal(
  decideAskGate({ ...clean, tag: "scope-adjust", reviewMode: "Product Spec Gate", forced: true, groups: [{ ...scopeKeep, multiple: false }] }).allowed,
  true,
  "--force bypasses malformed shape too, like the rest of the intent family",
);

console.log("ask gate test ok: duplicate, intent, evidence precedence pinned");

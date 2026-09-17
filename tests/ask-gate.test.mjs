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

console.log("ask gate test ok: duplicate, intent, evidence precedence pinned");

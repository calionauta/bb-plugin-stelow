import assert from "node:assert/strict";
import { resolveScopeMapChallenge, validateScopeMapChallenge } from "../lib/scope-map.mjs";

const challenge = {
  schemaVersion: 1,
  challengeId: "challenge-queue-1",
  mapId: "map-queue-v1",
  mapShapeVersion: "v3",
  kind: "product-commitment",
  affectedScopeIds: ["scope-2"],
  reason: "The interface change introduces a new approval actor.",
  disposition: "human-decision-required",
  authority: "agent",
  evidence: ["simulated:product-gate"],
  requestedBy: "interface-contrast",
};

assert.deepEqual(validateScopeMapChallenge(challenge), [], "simulated product challenge satisfies the contract");
assert.deepEqual(resolveScopeMapChallenge(challenge), {
  destination: "shape",
  staleArtifacts: ["scope-map", "technical-plan", "selection"],
  requiresApproval: true,
}, "product commitment challenges return to Shape and stale dependent artifacts");

const scopeChallenge = structuredClone(challenge);
scopeChallenge.kind = "scope-boundary";
assert.deepEqual(resolveScopeMapChallenge(scopeChallenge).destination, "scope", "scope boundary challenges return to Scope");

const wrongRoute = structuredClone(challenge);
wrongRoute.kind = "scope-boundary";
wrongRoute.disposition = "research-required";
assert.throws(() => resolveScopeMapChallenge(wrongRoute), /disposition/, "scope challenges cannot claim a research route");

const invalid = structuredClone(challenge);
invalid.affectedScopeIds = [];
invalid.evidence = [];
assert.ok(validateScopeMapChallenge(invalid).some((issue) => issue.includes("affectedScopeIds")), "challenge requires affected scopes");
assert.ok(validateScopeMapChallenge(invalid).some((issue) => issue.includes("evidence")), "challenge requires evidence");

console.log("scope map challenge test ok: routing, stale artifacts, refusals");

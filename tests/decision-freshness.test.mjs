import assert from "node:assert/strict";
import { freshnessOf, isAuthoritative } from "../lib/decision-freshness.mjs";

const v1 = { shapeVersion: "s1", scopeMapVersion: "m1", touchedScopeIds: [] };
const receipt = { id: "r1", scopeIds: ["s1"], authorizesVersions: { shape_version: "s1", scopeMapVersion: "m1" } };

// Same versions, untouched: current and authoritative.
assert.equal(freshnessOf(receipt, v1), "current");
assert.equal(isAuthoritative(receipt, v1), true);

// Either version bumped past what the receipt saw: stale.
assert.equal(freshnessOf(receipt, { ...v1, shapeVersion: "s2" }), "stale");
assert.equal(freshnessOf(receipt, { ...v1, scopeMapVersion: "m2" }), "stale");
assert.equal(isAuthoritative(receipt, { ...v1, shapeVersion: "s2" }), false);

// Code under the decision moved: stale even at identical versions.
assert.equal(freshnessOf(receipt, { ...v1, touchedScopeIds: ["s1"] }), "stale");
assert.equal(freshnessOf(receipt, { ...v1, touchedScopeIds: ["other"] }), "current");

// No versions anywhere: unknown, never invented.
assert.equal(freshnessOf({ id: "r2" }, v1), "unknown");
assert.equal(freshnessOf(receipt, {}), "unknown");
assert.equal(freshnessOf(null, v1), "unknown");

console.log("decision-freshness: ok");

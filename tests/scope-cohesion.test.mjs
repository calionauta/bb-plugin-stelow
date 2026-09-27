import assert from "node:assert/strict";
import { findScopeCollisions } from "../lib/scope-cohesion.mjs";

// Overlapping symbol yields one collision pair.
{
  const out = findScopeCollisions([
    { id: "a", symbols: ["X", "Y"] },
    { id: "b", symbols: ["Y", "Z"] },
    { id: "c", symbols: ["W"] },
  ]);
  assert.deepEqual(out, [{ a: "a", b: "b", shared: ["Y"] }]);
}

// Symbols dedupe and whitespace-trim before comparison.
{
  const out = findScopeCollisions([
    { id: "a", symbols: [" X ", "X", "Y"] },
    { id: "b", symbols: ["X"] },
  ]);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].shared, ["X"]);
}

// Renaming the shared symbol removes the collision (invert-behavior check).
{
  const out = findScopeCollisions([
    { id: "a", symbols: ["X"] },
    { id: "b", symbols: ["Y"] },
  ]);
  assert.deepEqual(out, []);
}

// Disjoint scopes yield [], not null.
{
  const out = findScopeCollisions([
    { id: "a", symbols: ["X"] },
    { id: "b", symbols: ["Y"] },
    { id: "c", symbols: ["W"] },
  ]);
  assert.deepEqual(out, []);
}

// Off-shape inputs yield null, never throw.
assert.equal(findScopeCollisions(null), null, "null");
assert.equal(findScopeCollisions({}), null, "object");
assert.equal(findScopeCollisions("not json"), null, "string");
assert.equal(findScopeCollisions([{ id: "a" }]), null, "missing symbols");
assert.equal(findScopeCollisions([{ id: "a", symbols: "X" }]), null, "non-array symbols");

console.log("scope cohesion test ok: collisions, dedupe/trim, empty vs null");

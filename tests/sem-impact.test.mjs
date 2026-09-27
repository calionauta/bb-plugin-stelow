import assert from "node:assert/strict";
import { summarizeSemImpact } from "../lib/sem-impact.mjs";

// Full shape mirrors `sem impact --format json`.
const FULL = {
  entity: { entityId: "E", file: "f", lines: [1, 2], name: "N", type: "function" },
  dependencies: [{ entityId: "D", file: "f", lines: [3, 4], name: "M", type: "function" }],
  dependents: [],
  impact: {
    depth: 2,
    total: 1,
    entities: [{ depth: 1, entityId: "T", file: "g", lines: [5, 6], name: "T", type: "function" }],
  },
  tests: [{ entityId: "TT", file: "t", lines: [7, 8], name: "tn", type: "test" }],
};

// Full shape maps entityId -> id and splits impact.entities into transitive.
{
  const out = summarizeSemImpact(FULL);
  assert.deepEqual(out.entity, { id: "E", name: "N", type: "function", file: "f", lines: [1, 2] });
  assert.equal(out.dependencies.length, 1);
  assert.deepEqual(out.dependencies[0], { id: "D", name: "M", type: "function", file: "f", lines: [3, 4] });
  assert.deepEqual(out.dependents, []);
  assert.equal(out.transitive.length, 1);
  assert.deepEqual(out.transitive[0], { id: "T", depth: 1, name: "T", type: "function", file: "g", lines: [5, 6] });
  assert.equal(out.tests.length, 1);
  assert.deepEqual(out.tests[0], { id: "TT", name: "tn", type: "test", file: "t", lines: [7, 8] });
}

// Inverted ids propagate (guards against hardcoded E/D/T/TT).
{
  const flipped = structuredClone(FULL);
  flipped.entity.entityId = "E2";
  flipped.dependencies[0].entityId = "D2";
  flipped.impact.entities[0].entityId = "T2";
  flipped.tests[0].entityId = "TT2";
  const out = summarizeSemImpact(flipped);
  assert.equal(out.entity.id, "E2");
  assert.equal(out.dependencies[0].id, "D2");
  assert.equal(out.transitive[0].id, "T2");
  assert.equal(out.tests[0].id, "TT2");
}

// Tests-only shape defaults missing lists to [].
{
  const out = summarizeSemImpact({
    entity: { entityId: "E", file: "f", lines: [1, 2], name: "N", type: "function" },
    tests: [{ entityId: "TT", file: "t", lines: [7, 8], name: "tn", type: "test" }],
  });
  assert.deepEqual(out.dependencies, []);
  assert.deepEqual(out.dependents, []);
  assert.deepEqual(out.transitive, []);
  assert.equal(out.tests.length, 1);
  assert.equal(out.tests[0].id, "TT");
}

// Off-shape inputs yield null, never throw.
assert.equal(summarizeSemImpact(null), null, "null");
assert.equal(summarizeSemImpact("not json"), null, "string");
assert.equal(summarizeSemImpact([]), null, "array");
assert.equal(summarizeSemImpact({}), null, "empty object");
assert.equal(summarizeSemImpact({ tests: [] }), null, "no entity");
assert.equal(
  summarizeSemImpact({ entity: { file: "f", lines: [1, 2], name: "N", type: "function" } }),
  null,
  "entity without id",
);

console.log("sem impact test ok: full map, tests-only defaults, off-shape nulls");

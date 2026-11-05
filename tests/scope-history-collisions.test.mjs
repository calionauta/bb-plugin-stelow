import assert from "node:assert/strict";
import test from "node:test";
import { reconcileScopeHistory } from "../lib/scope-history-reconcile.mjs";

function fixture(incomingId = "1.1") {
  const task = { id: "1.1", name: "Original responsibility", status: "done", record: { receipt: "original" } };
  const previous = {
    name: "collision-fixture",
    specTechFile: "spec-tech_v1.md",
    scopes: [
      { id: "scope-1", name: "Keep", status: "in-progress", tasks: [task] },
      { id: "scope-6", name: "Tests", status: "pending", tasks: [] },
    ],
  };
  const generated = {
    name: previous.name,
    specTechFile: "spec-tech_v2.md",
    scopes: [
      { id: "scope-1", name: "Keep", tasks: [] },
      { id: "scope-6", name: "Tests", tasks: [{ id: incomingId, name: "Original responsibility", status: "pending" }] },
    ],
  };
  return { previous, generated, options: { at: "2026-11-05T12:00:00Z", specSha256: "b".repeat(64) } };
}

for (const incomingId of ["1.1", "scope-1-t1"]) {
  test(`retained task cannot also be seeded under another surviving scope: ${incomingId}`, () => {
    const { previous, generated, options } = fixture(incomingId);
    const before = structuredClone([previous, generated, options]);
    const result = reconcileScopeHistory(previous, generated, options);
    assert.equal(result.ok, false, "the merged tracker must keep canonical task IDs globally unique");
    assert.equal(typeof result.error, "string");
    assert.deepEqual([previous, generated, options], before);
  });
}

test("an explicit cross-scope move preserves one original record", () => {
  const { previous, generated, options } = fixture();
  options.taskMoves = [{ fromScope: "scope-1", taskId: "1.1", toScope: "scope-6" }];
  const result = reconcileScopeHistory(previous, generated, options);
  assert.equal(result.ok, true);
  assert.deepEqual(result.workflow.scopes[0].tasks, []);
  assert.deepEqual(result.workflow.scopes[1].tasks, previous.scopes[0].tasks);
});

test("a moved task cannot also be seeded in a third scope", () => {
  const { previous, generated, options } = fixture();
  generated.scopes.push({ id: "scope-7", name: "Integration", tasks: [] });
  options.taskMoves = [{ fromScope: "scope-1", taskId: "1.1", toScope: "scope-7" }];
  const before = structuredClone([previous, generated, options]);
  const result = reconcileScopeHistory(previous, generated, options);
  assert.equal(result.ok, false, "an explicit move cannot duplicate its canonical ID elsewhere");
  assert.equal(typeof result.error, "string");
  assert.deepEqual([previous, generated, options], before);
});

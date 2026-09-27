import assert from "node:assert/strict";
import { summarizePlanLanes } from "../lib/ripwire-lanes.mjs";

// Real-shape input mirrors plan lanes JSON (snake_case wire format).
const FIXTURE = {
  lanes: [{ id: "lane-0", task: "auth" }, { id: "lane-1", task: "billing" }],
  pairs: [
    {
      a: "lane-0",
      b: "lane-1",
      conflicts: [{ key: "abc", p: "./a.ts", n: "foo" }],
      conflict_count: 2,
      same_file_risk: [],
      risk_count: 0,
      contract_touch: [],
      touch_count: 0,
    },
  ],
  landing_order: ["lane-0", "lane-1"],
  warnings: [{ code: "name-based-callgraph", sev: "info", text: "t" }],
};

// Full mapping: snake_case -> camelCase, p/n -> path/symbol, warnings -> codes.
{
  const summary = summarizePlanLanes(FIXTURE);
  assert.deepEqual(summary, {
    lanes: [{ id: "lane-0", task: "auth" }, { id: "lane-1", task: "billing" }],
    pairs: [
      {
        a: "lane-0",
        b: "lane-1",
        conflicts: [{ key: "abc", path: "./a.ts", symbol: "foo" }],
        conflictCount: 2,
        sameFileRisk: [],
        riskCount: 0,
        contractTouch: [],
        touchCount: 0,
      },
    ],
    landingOrder: ["lane-0", "lane-1"],
    sequentialize: [{ a: "lane-0", b: "lane-1", reason: "shared-claim" }],
    warnings: ["name-based-callgraph"],
  });
}

function pairFixture(overrides) {
  return {
    lanes: [{ id: "lane-0", task: "auth" }, { id: "lane-1", task: "billing" }],
    pairs: [
      {
        a: "lane-0",
        b: "lane-1",
        conflicts: [],
        conflict_count: 0,
        same_file_risk: [],
        risk_count: 0,
        contract_touch: [],
        touch_count: 0,
        ...overrides,
      },
    ],
    landing_order: ["lane-0", "lane-1"],
    warnings: [],
  };
}

// risk_count alone sequentializes as same-file.
{
  const summary = summarizePlanLanes(pairFixture({ risk_count: 1 }));
  assert.deepEqual(summary?.sequentialize, [{ a: "lane-0", b: "lane-1", reason: "same-file" }]);
}

// touch_count alone sequentializes as contract-touch.
{
  const summary = summarizePlanLanes(pairFixture({ touch_count: 2 }));
  assert.deepEqual(summary?.sequentialize, [{ a: "lane-0", b: "lane-1", reason: "contract-touch" }]);
}

// All zeros produce no sequentialize entry.
{
  const summary = summarizePlanLanes(pairFixture({}));
  assert.deepEqual(summary?.sequentialize ?? [], []);
}

// Off-shape and empty inputs yield null, never throw.
assert.equal(summarizePlanLanes(null), null, "null");
assert.equal(summarizePlanLanes("x"), null, "string");
assert.equal(summarizePlanLanes([]), null, "array");
assert.equal(summarizePlanLanes({}), null, "empty object");
assert.equal(summarizePlanLanes({ lanes: [] }), null, "no pairs array");

// Conflict rows cap at 20.
{
  const rows = Array.from({ length: 25 }, (_, i) => ({ key: `k${i}`, p: `./f${i}.ts`, n: `sym${i}` }));
  const summary = summarizePlanLanes(pairFixture({ conflicts: rows, conflict_count: 25 }));
  assert.equal(summary?.pairs[0].conflicts.length, 20, "capped at 20");
}

// Rows with no key/path/symbol at all are dropped.
{
  const summary = summarizePlanLanes(
    pairFixture({
      conflicts: [{ key: "keep", p: "./a.ts", n: "foo" }, {}, { key: "", p: "", n: "" }],
      conflict_count: 3,
    }),
  );
  assert.equal(summary?.pairs[0].conflicts.length, 1, "empty rows dropped");
  assert.deepEqual(summary?.pairs[0].conflicts[0], { key: "keep", path: "./a.ts", symbol: "foo" });
}

console.log("ripwire lanes test ok: mapping, sequentialize reasons, off-shape nulls, conflict cap");

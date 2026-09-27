import assert from "node:assert/strict";
import { summarizeTestGate, summarizeQualityDelta } from "../lib/ripwire-gates.mjs";

// TestGate: non-empty obligation lists force obligations true, counts pass through.
{
  const out = summarizeTestGate({
    changed: 1,
    impacted: 2,
    tests: 3,
    untested: 1,
    tests_to_run: ["a"],
    untested_blast_radius: ["b"],
  });
  assert.equal(out.changed, 1);
  assert.equal(out.impacted, 2);
  assert.equal(out.tests, 3);
  assert.equal(out.untested, 1);
  assert.equal(out.obligations, true);
}

// TestGate: all-empty lists clear obligations (invert-behavior check).
{
  const out = summarizeTestGate({
    changed: 0,
    impacted: 0,
    tests: 0,
    untested: 0,
    tests_to_run: [],
    untested_blast_radius: [],
  });
  assert.equal(out.obligations, false);
  assert.equal(out.changed, 0);
}

// TestGate off-shape yields null, never throws.
assert.equal(summarizeTestGate(null), null, "null");
assert.equal(summarizeTestGate([]), null, "array");
assert.equal(summarizeTestGate("not json"), null, "string");

// QualityDelta: any nonzero regression count blocks.
{
  const out = summarizeQualityDelta({ baseline: "git-HEAD", regressions: 1, minor: 0, gating: 0 });
  assert.equal(out.baseline, "git-HEAD");
  assert.equal(out.regressions, 1);
  assert.equal(out.blocked, true);
}

// QualityDelta: all zeros leave blocked false (invert-behavior check).
{
  const out = summarizeQualityDelta({ baseline: "git-HEAD", regressions: 0, minor: 0, gating: 0 });
  assert.equal(out.blocked, false);
}

// QualityDelta: missing baseline yields null baseline, not a null return.
{
  const out = summarizeQualityDelta({ regressions: 0, minor: 0, gating: 0 });
  assert.notEqual(out, null, "missing baseline still returns object");
  assert.equal(out.baseline, null);
  assert.equal(out.blocked, false);
}

// QualityDelta off-shape yields null, never throws.
assert.equal(summarizeQualityDelta(null), null, "null");
assert.equal(summarizeQualityDelta([]), null, "array");
assert.equal(summarizeQualityDelta("not json"), null, "string");

console.log("ripwire gates test ok: obligations, blocked flag, baseline null, off-shape nulls");

import assert from "node:assert/strict";
import { MAX_OPTIMIZE_ITERATIONS, validateOptimizeRequest } from "../lib/optimize-stop.mjs";

// The stop rule up front: failure mode + measurable target + a bound.
// "Make it better" with no target and no bound is refused, not looped.
const healthy = {
  failureMode: "null input crashes the handler",
  metricTarget: "zero crashes on the null-input bench",
  maxIterations: 5,
};
assert.deepEqual(validateOptimizeRequest(healthy), [], "named failure with target and cap goes");
assert.deepEqual(
  validateOptimizeRequest({
    ...healthy,
    stopRules: ["Do not change public API signatures"],
  }),
  [],
  "stop rules ride along as guards, the count stays the bound",
);
assert.ok(
  validateOptimizeRequest({
    failureMode: "p99 over budget",
    metricTarget: "p99 under 200ms on the checkout bench",
    stopRules: ["Do not change public API signatures"],
  }).some((issue) => issue.includes("maxIterations is required")),
  "rules without a count are still unbounded, refused",
);
assert.ok(
  validateOptimizeRequest({ metricTarget: "faster", maxIterations: 3 }).some((issue) => issue.includes("failureMode")),
  "unnamed failure is refused",
);
assert.ok(
  validateOptimizeRequest({ failureMode: "slow", maxIterations: 3 }).some((issue) => issue.includes("metricTarget")),
  "unmeasured target is refused",
);
assert.ok(
  validateOptimizeRequest({ failureMode: "slow", metricTarget: "faster" }).some((issue) => issue.includes("maxIterations is required")),
  "unbounded pass is refused",
);
assert.ok(
  validateOptimizeRequest({ ...healthy, maxIterations: MAX_OPTIMIZE_ITERATIONS + 1 }).length > 0,
  "cap above the ceiling is refused",
);
assert.ok(
  validateOptimizeRequest({ ...healthy, stopRules: [" "] }).length > 0,
  "blank stop rule is refused",
);
assert.deepEqual(
  validateOptimizeRequest(null),
  ["optimize request must be an object"],
  "malformed input fails closed",
);

console.log("optimize stop test ok: stop rule required before the first iteration");

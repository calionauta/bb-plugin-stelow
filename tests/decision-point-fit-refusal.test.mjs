import assert from "node:assert/strict";
import { resolvePointWrite } from "../server/decision-point-rules.ts";

const deps = { presetExists: () => true };

// Explicit labels pin on a Noul point in api mode: refused with both exits.
{
  const refused = resolvePointWrite(
    { point: "retry-transient", mode: "api", route: { provider: "classifier" } },
    undefined,
    deps,
  );
  assert.equal(refused.ok, false, "labels+Noul in api mode refuses");
  if (!refused.ok) {
    assert.match(refused.error, /Choice only/i, "refusal names the provider limit");
    assert.match(refused.error, /rules/i, "refusal names the rules exit");
  }
}

// Same pin on a Choice point: allowed.
{
  const allowed = resolvePointWrite(
    { point: "preset-tier", mode: "api", route: { provider: "classifier" } },
    undefined,
    deps,
  );
  assert.equal(allowed.ok, true, "labels+Choice in api mode is allowed");
}

// Existing mismatched pin poisons later saves until fixed.
{
  const existing = {
    point: "auto-continue",
    mode: "api",
    thresholds: "{}",
    provider: "classifier",
    endpoint: null,
    api_key: null,
    model: null,
    preset_id: null,
  };
  const refused = resolvePointWrite({ point: "auto-continue", mode: "api", thresholds: { routeAt: 0.8 } }, existing, deps);
  assert.equal(refused.ok, false, "effective mismatch refuses even threshold-only saves");
}

// Rules mode never cares about provider fit.
{
  const allowed = resolvePointWrite(
    { point: "retry-transient", mode: "rules", route: { provider: "classifier" } },
    undefined,
    deps,
  );
  assert.equal(allowed.ok, true, "rules mode accepts any provider pin");
}

// No explicit provider anywhere: shared default resolves at call time,
// so the write cannot judge fit and must not block.
{
  const allowed = resolvePointWrite({ point: "retry-transient", mode: "api" }, undefined, deps);
  assert.equal(allowed.ok, true, "unnamed provider never blocks a save");
}

console.log("decision point fit refusal test ok: explicit mismatches refuse with exits");

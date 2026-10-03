import assert from "node:assert/strict";
import { riskReading } from "../lib/risk-reading.mjs";

// One shared risk reading for gaps, scopes, and tasks: severity if it
// ships, blast radius, reversibility, verifiability. Levels derive from
// severity plus reversibility only — caller counts and checks travel as
// cited reasons, because any numeric blast threshold would be an invented
// number nobody calibrated.

assert.deepEqual(
  riskReading({ impact: "critical" }),
  { level: "high", reasons: [] },
  "critical reads high with no measurements",
);
assert.deepEqual(
  riskReading({ impact: "high", callers: 38, reversible: "no", check: null }),
  { level: "high", reasons: ["38 caller(s)", "irreversible", "no proving check"] },
  "measurements travel as reasons, not as a score",
);
assert.deepEqual(
  riskReading({ impact: "medium", reversible: "no" }).level,
  "high",
  "irreversible bumps moderate to high",
);
assert.deepEqual(
  riskReading({ impact: "low", reversible: "no" }).level,
  "moderate",
  "irreversible bumps low to moderate",
);
assert.deepEqual(
  riskReading({ impact: "low", reversible: "yes", check: "npm test" }).level,
  "low",
  "reversible with a check stays low",
);
assert.deepEqual(
  riskReading({ impact: "medium" }),
  { level: "moderate", reasons: [] },
  "medium reads moderate",
);
assert.deepEqual(
  riskReading({ callers: 38 }),
  { level: "unknown", reasons: ["38 caller(s)", "no proving check"] },
  "measurements without severity read unknown — blast is not severity",
);
assert.deepEqual(
  riskReading(null),
  { level: "unknown", reasons: [] },
  "junk reads unknown, never throws",
);
assert.deepEqual(
  riskReading({ impact: "HIGH ", reversible: "NO" }).level,
  "high",
  "casing and padding never matter",
);

console.log("risk reading test ok: shared levels for gaps, scopes, and tasks");

import assert from "node:assert/strict";
import { providerServesPoint } from "../lib/decision-api.mjs";
import {
  autoContinueQuestions,
  needsSchemaForPoint,
  pointsServedBySchema,
  presetTierQuestions,
  questionKindsForPoint,
  retryTransientQuestions,
  severityBumpQuestions,
  triageIntentQuestions,
} from "../lib/decision-points.mjs";
import {
  criteriaEvidenceQuestion,
  semanticCriterionToScore,
} from "../lib/skill-criteria.mjs";

// Provider fit is mechanical: labels-schema answers Choice only.
assert.equal(providerServesPoint("classifier", ["choice"]), true, "labels serve Choice points");
assert.equal(providerServesPoint("classifier", ["noul"]), false, "labels cannot serve Noul points");
assert.equal(providerServesPoint("classifier", ["score", "noul"]), false, "labels cannot serve Score points");
assert.equal(providerServesPoint("simplejev", ["noul"]), true, "jev-schema serves everything");
assert.equal(providerServesPoint("jev", ["score"]), true, "keyed jev serves everything");
assert.equal(providerServesPoint("mystery", ["noul"]), true, "unknown providers degrade to the jev default");
assert.equal(providerServesPoint("classifier", []), false, "empty kinds never claim fit");

// Declared needs match the builders' real output: a builder that drifts
// its question type without updating its entry fails here, not in prod.
function builtKinds(questions) {
  return [...new Set(Object.values(questions).map((question) => question.type))].sort();
}
const cases = [
  ["triage-intent", triageIntentQuestions()],
  ["preset-tier", presetTierQuestions()],
  ["auto-continue", autoContinueQuestions()],
  ["inbox-severity", severityBumpQuestions()],
  ["retry-transient", retryTransientQuestions()],
];
for (const [id, questions] of cases) {
  assert.deepEqual(builtKinds(questions), [...questionKindsForPoint(id)].sort(), `${id} builders match declared kinds`);
}
assert.deepEqual(
  [...builtKinds(semanticCriterionToScore({ id: "x", text: "y" })), ...builtKinds(criteriaEvidenceQuestion())].sort(),
  [...questionKindsForPoint("artifact-criteria")].sort(),
  "criteria builders match declared kinds",
);

// needsSchema derives from kinds: Choice-only serves labels.
assert.equal(needsSchemaForPoint("triage-intent"), "any", "triage serves labels");
assert.equal(needsSchemaForPoint("preset-tier"), "any", "tier serves labels");
assert.equal(needsSchemaForPoint("auto-continue"), "jev", "veto needs jev-schema");
assert.equal(needsSchemaForPoint("retry-transient"), "jev", "retry needs jev-schema");
assert.equal(needsSchemaForPoint("artifact-criteria"), "jev", "criteria need jev-schema");
assert.equal(needsSchemaForPoint("no-such-point"), "jev", "unknown points fail closed");

// The served list is derived, never pasted: adding a Choice point updates it.
assert.deepEqual(
  pointsServedBySchema("labels").sort(),
  ["Preset tier", "Triage intent"],
  "labels serve exactly the Choice points",
);
assert.equal(pointsServedBySchema("jev").length, 6, "jev-schema serves every registered point");

console.log("decision provider fit test ok: mechanical fit, builder consistency, derived lists");

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateInterfaceContrastReceipt } from "../lib/interface-contrast.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const schema = JSON.parse(readFileSync(join(root, "data", "stelow-assets", "schemas", "interface-contrast.json"), "utf8"));

// Context: the runtime validator and the published JSON schema were two
// independent sources of truth. The schema said `items: {type: "object"}` —
// any object passed — while lib/interface-contrast.mjs required
// `fixedConstraints[].source` and `evidence[].claim`. A worker that followed
// the schema produced a receipt the host rejected as `artifact-malformed`,
// burning a whole run on a contract that had never been contradicted. The
// card showed "Working" forever and the decision question was lost.
const itemRequired = (name) => schema.properties[name].items.required;

assert.deepEqual(
  itemRequired("fixedConstraints"),
  ["name", "value", "source"],
  "the schema requires exactly the fields the validator requires",
);
assert.deepEqual(
  itemRequired("evidence"),
  ["source", "reference", "claim"],
  "evidence carries the same required trio the validator checks",
);
assert.deepEqual(
  itemRequired("options"),
  ["id", "primaryValue", "compatibility"],
  "options carry the same required trio the validator checks",
);
assert.deepEqual(
  schema.properties.evidence.items.properties.source.enum,
  ["fixture", "scenario", "simulation", "measured", "human"],
  "the schema's evidence sources match the validator's closed set",
);
assert.equal(
  schema.properties.options.items.properties.compatibility.const,
  "valid",
  "the schema pins the only compatibility value the validator accepts",
);

// The drift that actually happened, pinned as a regression: a receipt shaped
// like the loose schema used to validate cleanly at the schema layer and fail
// at the runtime validator. Now both layers reject it, so the mismatch can
// never ship again.
const looseReceipt = {
  schemaVersion: 1,
  receiptId: "receipt-loose",
  route: "interface-refinement",
  briefStatus: "generation-ready",
  authority: "agent",
  disposition: "continue",
  shapeVersion: "spec-product_v2",
  fixedConstraints: [{ id: "read-only", value: "no mutations" }],
  criteria: ["one", "two"],
  evidence: [{ description: "looked at the code" }],
  options: [{ id: "A", primaryValue: "keep", compatibility: "valid" }],
  nextAction: "proceed",
};
const issues = validateInterfaceContrastReceipt(looseReceipt);
assert.ok(
  issues.some((issue) => issue.includes("fixedConstraints[0] requires name, value, and source")),
  "a constraint missing `source` is still rejected by the runtime validator",
);
assert.ok(
  issues.some((issue) => issue.includes("evidence[0] requires a supported source")),
  "an evidence entry without a supported source is still rejected",
);

// And the well-formed receipt passes both, so tightening the schema did not
// make the contract unreachable.
const good = {
  ...looseReceipt,
  decisionQuestion: "Extend the Scope stage or add a new surface?",
  primaryDimension: "placement",
  fixedConstraints: [{ name: "read-only", value: "no mutations", source: "human" }],
  evidence: [{ source: "measured", reference: "git diff", claim: "no writes" }],
};
assert.deepEqual(validateInterfaceContrastReceipt(good), [], "a receipt satisfying the schema also satisfies the validator");

console.log("interface contrast schema parity test ok: schema and runtime validator agree field for field");

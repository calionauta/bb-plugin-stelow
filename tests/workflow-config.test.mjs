import assert from "node:assert/strict";
import { DEFAULT_APPETITE, DEFAULT_REVIEW_MODE, parseWorkflowConfig } from "../lib/workflow-config.mjs";
import { STATE_TEMPLATE } from "../lib/state-template.mjs";

// Regression: config lives indented under `config:` (see
// lib/state-template.mjs). An anchored `^appetite:` reader missed it
// (silent Lean/Auto fallback) and a bare `(\S+)` truncated multi-word
// review modes — live children inherited `review_mode: Product`.
const indented = `---\nworkflow_id: card_1\nintent: refactor\nconfig:\n  appetite: Complete\n  review_mode: Product Spec + Interface + Tech Review\n  product_type: software\n---\n`;
assert.deepEqual(
  parseWorkflowConfig(indented),
  { appetite: "Complete", reviewMode: "Product Spec + Interface + Tech Review" },
  "the indented config block parses whole, never truncated",
);

const quoted = `config:\n  appetite: "Core"\n  review_mode: 'Product Spec Gate'\n`;
assert.deepEqual(
  parseWorkflowConfig(quoted),
  { appetite: "Core", reviewMode: "Product Spec Gate" },
  "optional quoting is stripped",
);

const topLevel = `appetite: Core\nreview_mode: Auto\n`;
assert.deepEqual(
  parseWorkflowConfig(topLevel),
  { appetite: "Core", reviewMode: "Auto" },
  "legacy top-level keys still parse",
);

assert.deepEqual(
  parseWorkflowConfig("---\nintent: refactor\n---\n"),
  { appetite: DEFAULT_APPETITE, reviewMode: DEFAULT_REVIEW_MODE },
  "missing fields fail open to Lean/Auto",
);
assert.deepEqual(parseWorkflowConfig(null), { appetite: "Lean", reviewMode: "Auto" }, "a missing blob fails open, never throws");
assert.deepEqual(parseWorkflowConfig(""), { appetite: "Lean", reviewMode: "Auto" }, "an empty blob fails open, never throws");

// Schema guarantee: what seeding writes, the reader reads back whole.
// Mirrors ensureWorkflow's template substitution exactly, so the write
// boundary (strict zod enums at the RPC) and the read boundary can never
// disagree again.
const seeded = STATE_TEMPLATE.replace("appetite: Core", "appetite: Complete").replace(
  "review_mode: Auto",
  "review_mode: Product Spec + Interface + Tech Review",
);
assert.deepEqual(
  parseWorkflowConfig(seeded),
  { appetite: "Complete", reviewMode: "Product Spec + Interface + Tech Review" },
  "seeded values round-trip complete through template and parser",
);

console.log("workflow config test ok: indented block, quotes, fallbacks, no truncation");

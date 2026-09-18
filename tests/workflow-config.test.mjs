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
  { appetite: "Complete", reviewMode: "Product Spec + Interface + Tech Review", reviewGates: ["spec", "interface", "scope", "tech"] },
  "the indented config block parses whole, never truncated",
);

const quoted = `config:\n  appetite: "Core"\n  review_mode: 'Product Spec Gate'\n`;
assert.deepEqual(
  parseWorkflowConfig(quoted),
  { appetite: "Core", reviewMode: "Product Spec Gate", reviewGates: ["spec"] },
  "optional quoting is stripped",
);

const topLevel = `appetite: Core\nreview_mode: Auto\n`;
assert.deepEqual(
  parseWorkflowConfig(topLevel),
  { appetite: "Core", reviewMode: "Auto", reviewGates: [] },
  "legacy top-level keys still parse",
);

assert.deepEqual(
  parseWorkflowConfig("---\nintent: refactor\n---\n"),
  { appetite: DEFAULT_APPETITE, reviewMode: DEFAULT_REVIEW_MODE, reviewGates: [] },
  "missing fields fail open to Lean/Auto",
);
assert.deepEqual(parseWorkflowConfig(null), { appetite: "Lean", reviewMode: "Auto", reviewGates: [] }, "a missing blob fails open, never throws");
assert.deepEqual(parseWorkflowConfig(""), { appetite: "Lean", reviewMode: "Auto", reviewGates: [] }, "an empty blob fails open, never throws");

// Strict mode distinguishes "declared" from "assumed": guards must never
// enforce against a default the file never stated.
assert.deepEqual(
  parseWorkflowConfig(indented, { strict: true }),
  { appetite: "Complete", reviewMode: "Product Spec + Interface + Tech Review", reviewGates: ["spec", "interface", "scope", "tech"] },
  "strict keeps declared values",
);
assert.deepEqual(
  parseWorkflowConfig("---\nintent: refactor\n---\n", { strict: true }),
  { appetite: null, reviewMode: null, reviewGates: null },
  "strict returns nulls instead of defaults",
);
assert.deepEqual(parseWorkflowConfig(null, { strict: true }), { appetite: null, reviewMode: null, reviewGates: null }, "strict never throws either");

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
  { appetite: "Complete", reviewMode: "Product Spec + Interface + Tech Review", reviewGates: ["spec", "interface", "scope", "tech"] },
  "seeded values round-trip complete through template and parser",
);

// The canonical set survives alongside the legacy ladder label: an
// explicit flow list wins, and gates-only blobs stay legible to
// ladder-only readers through the compat label.
assert.deepEqual(
  parseWorkflowConfig(`config:\n  review_gates: [spec, tech]\n  review_mode: Auto\n`),
  { appetite: "Lean", reviewMode: "Auto", reviewGates: ["spec", "tech"] },
  "an explicit flow list wins over the ladder string",
);
assert.deepEqual(
  parseWorkflowConfig(`config:\n  review_gates: [interface]\n`, { strict: true }).reviewGates,
  ["interface"],
  "strict keeps a gates-only declaration",
);

console.log("workflow config test ok: indented block, quotes, fallbacks, no truncation");

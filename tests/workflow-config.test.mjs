import assert from "node:assert/strict";
import { DEFAULT_APPETITE, DEFAULT_REVIEW_MODE, parseWorkflowConfig, resolveKnobInput } from "../lib/workflow-config.mjs";
import { STATE_TEMPLATE } from "../lib/state-template.mjs";

// Regression: config lives indented under `config:` (see
// lib/state-template.mjs). An anchored `^quality:` reader missed it
// (silent production/Auto fallback) and a bare `(\S+)` truncated multi-word
// review modes — live children inherited `review_mode: Product`.
const PROD3 = {
  quality: "production",
  supervisor: "high",
  explorationCount: 3,
  explorationHybrid: true,
};
const FULL_GATES = ["spec", "interface", "scope", "tech"];

const indented = `---\nworkflow_id: card_1\nintent: refactor\nconfig:\n` +
  `  quality: production\n  supervisor: high\n  exploration_count: 4\n` +
  `  exploration_hybrid: true\n  review_mode: Product Spec + Interface + Tech Review\n` +
  `  product_type: software\n---\n`;
assert.deepEqual(
  parseWorkflowConfig(indented),
  {
    ...PROD3,
    explorationCount: 4,
    appetite: DEFAULT_APPETITE,
    reviewMode: "Product Spec + Interface + Tech Review",
    reviewGates: FULL_GATES,
  },
  "the indented config block parses whole, never truncated",
);

const quoted = `config:\n  quality: "experimental"\n  review_mode: 'Product Spec Gate'\n`;
assert.deepEqual(
  parseWorkflowConfig(quoted),
  {
    ...PROD3,
    quality: "experimental",
    appetite: DEFAULT_APPETITE,
    reviewMode: "Product Spec Gate",
    reviewGates: ["spec"],
  },
  "optional quoting is stripped",
);

const topLevel = `quality: experimental\nreview_mode: Auto\n`;
assert.deepEqual(
  parseWorkflowConfig(topLevel),
  { ...PROD3, quality: "experimental", appetite: DEFAULT_APPETITE, reviewMode: "Auto", reviewGates: [] },
  "legacy top-level keys still parse",
);

// A legacy appetite line maps once: rigor always strongest, breadth keeps
// the old intent. The mapping is announced by the reader carrying both.
const legacy = `---\nworkflow_id: card_9\nintent: feature\nconfig:\n` +
  `  appetite: Complete\n  review_mode: Product Spec + Interface + Tech Review\n` +
  `  product_type: software\n---\n`;
assert.deepEqual(
  parseWorkflowConfig(legacy),
  {
    ...PROD3,
    explorationCount: 5,
    appetite: "Complete",
    reviewMode: "Product Spec + Interface + Tech Review",
    reviewGates: FULL_GATES,
  },
  "a legacy appetite line maps once to knobs",
);

const OPEN_DEFAULTS = {
  ...PROD3,
  appetite: DEFAULT_APPETITE,
  reviewMode: DEFAULT_REVIEW_MODE,
  reviewGates: [],
};
assert.deepEqual(
  parseWorkflowConfig("---\nintent: refactor\n---\n"),
  OPEN_DEFAULTS,
  "missing fields fail open to production/high/3/Auto",
);
assert.deepEqual(parseWorkflowConfig(null), { ...OPEN_DEFAULTS, appetite: "Lean" }, "a missing blob fails open");
assert.deepEqual(parseWorkflowConfig(""), { ...OPEN_DEFAULTS, appetite: "Lean" }, "an empty blob fails open");

// Strict mode distinguishes "declared" from "assumed": guards must never
// enforce against a default the file never stated.
assert.deepEqual(
  parseWorkflowConfig(indented, { strict: true }),
  {
    ...PROD3,
    explorationCount: 4,
    appetite: null,
    reviewMode: "Product Spec + Interface + Tech Review",
    reviewGates: FULL_GATES,
  },
  "strict keeps declared values",
);
const STRICT_NULLS = {
  quality: null,
  supervisor: null,
  explorationCount: null,
  explorationHybrid: null,
  appetite: null,
  reviewMode: null,
  reviewGates: null,
};
assert.deepEqual(
  parseWorkflowConfig("---\nintent: refactor\n---\n", { strict: true }),
  STRICT_NULLS,
  "strict returns nulls instead of defaults",
);
assert.deepEqual(parseWorkflowConfig(null, { strict: true }), STRICT_NULLS, "strict never throws either");

// Schema guarantee: what seeding writes, the reader reads back whole.
// Mirrors ensureWorkflow's template substitution exactly, so the write
// boundary (strict zod enums at the RPC) and the read boundary can never
// disagree again.
const seeded = STATE_TEMPLATE.replace("exploration_count: 3", "exploration_count: 5").replace(
  "review_mode: Auto",
  "review_mode: Product Spec + Interface + Tech Review",
);
assert.deepEqual(
  parseWorkflowConfig(seeded),
  {
    ...PROD3,
    explorationCount: 5,
    appetite: DEFAULT_APPETITE,
    reviewMode: "Product Spec + Interface + Tech Review",
    reviewGates: FULL_GATES,
  },
  "seeded values round-trip complete through template and parser",
);

// The canonical set survives alongside the legacy ladder label: an
// explicit flow list wins, and gates-only blobs stay legible to
// ladder-only readers through the compat label.
assert.deepEqual(
  parseWorkflowConfig(`config:\n  review_gates: [spec, tech]\n  review_mode: Auto\n`),
  { ...OPEN_DEFAULTS, reviewGates: ["spec", "tech"] },
  "an explicit flow list wins over the ladder string",
);
assert.deepEqual(
  parseWorkflowConfig(`config:\n  review_gates: [interface]\n`, { strict: true }).reviewGates,
  ["interface"],
  "strict keeps a gates-only declaration",
);

console.log("workflow config test ok: indented block, quotes, knobs, legacy mapping, fallbacks, no truncation");

// Red-first knob: an explicit valid mode passes through; anything else stays
// absent so the quality-derived default applies downstream (single source:
// absent never means a mode, it means "derive me").
assert.equal(
  resolveKnobInput({ quality: "production", redFirst: "off" }).redFirst,
  "off",
  "an explicit redFirst survives knob resolution",
);
assert.equal(
  resolveKnobInput({ quality: "production" }).redFirst,
  undefined,
  "an absent redFirst stays absent (quality default applies later)",
);
assert.equal(
  resolveKnobInput({ quality: "production", redFirst: "bogus" }).redFirst,
  undefined,
  "an invalid redFirst is dropped, never invented",
);

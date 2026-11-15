/**
 * Enforcement for the composite JTBD substeps.
 *
 * The split is deliberate. stelow declares which substeps exist, in what order,
 * what a complete artifact contains, and where the writing rules live; that
 * arrives here as generated data (lib/stelow-jtbd-contracts.mjs) and is checked
 * by tests/jtbd-contract-coverage.test.mjs. This file adds only what is this
 * host's own: the check DSL interpreted by lib/artifact-validation.mjs and the
 * depth floors below, which are policy and were never declared upstream.
 *
 * `ref` is derived from the vendored data, never typed here: when stelow renames
 * a reference file, review fails loudly instead of judging against a path that
 * no longer exists.
 */
import { findByKey } from "./artifact-contract-lookup.mjs";
import { STELOW_JTBD_CONTRACTS } from "./stelow-jtbd-contracts.mjs";

const NEED_FIELDS = [
  "Justification:",
  "Score:",
  "Metrics:",
  "Current alternative:",
];

const SEGMENTATION_FIELDS = [
  "Market:",
  "Justification:",
  "Situational factors:",
  "Scene:",
  "Observable difference:",
  "Cost of failure:",
];

const COMPETITOR_SECTIONS = [
  "Direct Competitors",
  "Indirect Competitors",
  "Hidden Competitors",
  "Key Insights",
];

const RAW_CONTRACTS = [
  {
    slug: "contextual-segmentation",
    minWords: 800,
    checks: [
      { kind: "field-blocks", marker: "## ", fields: SEGMENTATION_FIELDS, minBlocks: 4 },
    ],
  },
  {
    slug: "thinking-styles",
    minWords: 600,
    checks: [
      { kind: "headings", level: 2, min: 3, max: 7 },
      { kind: "table-rows", min: 9 },
      { kind: "contains", needles: ["Functional Jobs", "Emotional Jobs", "Social Jobs"] },
    ],
  },
  {
    slug: "jtbd-discovery",
    minWords: 600,
    checks: [
      {
        kind: "named-headings",
        level: 2,
        names: ["Rewritten JTBDs", "Contextual JTBDs", "Higher functional JTBDs"],
        match: "contains",
      },
      { kind: "section-items", heading: "Contextual JTBDs", min: 6 },
      { kind: "section-items", heading: "Rewritten JTBDs", min: 1 },
      { kind: "section-items", heading: "Higher functional JTBDs", min: 1 },
    ],
  },
  {
    slug: "competitors",
    minWords: 500,
    checks: [
      { kind: "named-headings", level: 2, names: COMPETITOR_SECTIONS, match: "contains" },
      ...COMPETITOR_SECTIONS.map((heading) => ({ kind: "section-items", heading, min: 3 })),
    ],
  },
  {
    slug: "job-actors",
    minWords: 350,
    checks: [
      { kind: "table-columns", names: ["Role", "Status", "Actor", "Market", "Warrant"] },
    ],
  },
  {
    slug: "situational-variables",
    minWords: 500,
    checks: [
      { kind: "headings", level: 2, startsWith: "Category", min: 5 },
      { kind: "headings", level: 3, startsWith: "Situational factor", min: 10 },
    ],
  },
  {
    slug: "functional-needs",
    minWords: 1200,
    checks: [
      { kind: "named-headings", level: 2, names: ["Top 10", "Summary of Success Criteria"], match: "contains" },
      { kind: "headings", level: 4, min: 5 },
      { kind: "field-blocks", marker: "#### ", fields: NEED_FIELDS, minBlocks: 5 },
      { kind: "table-rows", min: 5 },
    ],
  },
  {
    slug: "financial-needs",
    minWords: 1500,
    checks: [
      { kind: "named-headings", level: 2, names: ["Raw Success Criteria", "Top criteria"], match: "contains" },
      { kind: "section-items", heading: "Raw Success Criteria", min: 10 },
      { kind: "headings", level: 4, min: 5 },
      { kind: "field-blocks", marker: "#### ", fields: NEED_FIELDS, minBlocks: 5 },
    ],
  },
  {
    slug: "emotional-social-jobs",
    minWords: 400,
    checks: [
      { kind: "table-columns", names: ["Step", "Job", "Type", "Signal", "Status"] },
      { kind: "table-rows", min: 6 },
    ],
  },
  {
    slug: "job-map-steps",
    minWords: 500,
    checks: [
      { kind: "table-columns", names: ["Step", "Phase", "Executor", "Decider", "Output", "Failure mode", "Status"] },
      { kind: "table-rows", min: 5 },
    ],
  },
  {
    slug: "switch-interview",
    minWords: 300,
    checks: [
      { kind: "table-columns", names: ["Stage", "Status"] },
    ],
  },
];

const REF_BY_SLUG = new Map(
  STELOW_JTBD_CONTRACTS.substeps.map((substep) => [substep.slug, `skills/stelow-product-job-to-be-done/${substep.ref}`]),
);

/** The upstream substeps this plugin enforces, in stelow's own order. */
export const JTBD_SUBSTEPS = STELOW_JTBD_CONTRACTS.substeps;

function upstreamRef(slug) {
  const ref = REF_BY_SLUG.get(slug);
  if (!ref) {
    throw new Error(
      `jtbd-contracts: stelow no longer declares substep '${slug}' — run scripts/sync-jtbd-contracts.mjs and reconcile`,
    );
  }
  return ref;
}

export const JTBD_CONTRACTS = RAW_CONTRACTS.map((contract) => ({ ...contract, ref: upstreamRef(contract.slug) }));

/** Contract for a composite substep slug, or null when unmigrated. */
export function contractForSubstep(slug) {
  return findByKey(JTBD_CONTRACTS, "slug", slug);
}

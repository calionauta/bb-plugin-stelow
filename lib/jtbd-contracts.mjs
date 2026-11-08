/**
 * Depth contracts for the composite JTBD substeps. Each entry mirrors its
 * reference file's "Completeness contract" section — the plugin cites
 * `ref` so drift breaks review, not silently. The check DSL these entries
 * are written in is interpreted by lib/artifact-validation.mjs.
 */
import { findByKey } from "./artifact-contract-lookup.mjs";

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

export const JTBD_CONTRACTS = [
  {
    slug: "contextual-segmentation",
    ref: "skills/stelow-product-job-to-be-done/references/01-contextual-segmentation.md",
    minWords: 800,
    checks: [
      { kind: "field-blocks", marker: "## ", fields: SEGMENTATION_FIELDS, minBlocks: 4 },
    ],
  },
  {
    slug: "thinking-styles",
    ref: "skills/stelow-product-job-to-be-done/references/02-thinking-styles.md",
    minWords: 600,
    checks: [
      { kind: "headings", level: 2, min: 3, max: 7 },
      { kind: "table-rows", min: 9 },
      { kind: "contains", needles: ["Functional Jobs", "Emotional Jobs", "Social Jobs"] },
    ],
  },
  {
    slug: "jtbd-discovery",
    ref: "skills/stelow-product-job-to-be-done/references/03-jtbd-discovery.md",
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
    ref: "skills/stelow-product-job-to-be-done/references/04-competitors.md",
    minWords: 500,
    checks: [
      { kind: "named-headings", level: 2, names: COMPETITOR_SECTIONS, match: "contains" },
      ...COMPETITOR_SECTIONS.map((heading) => ({ kind: "section-items", heading, min: 3 })),
    ],
  },
  {
    slug: "job-actors",
    ref: "skills/stelow-product-job-to-be-done/references/05-job-actors.md",
    minWords: 350,
    checks: [
      { kind: "table-columns", names: ["Role", "Status", "Actor", "Market", "Warrant"] },
    ],
  },
  {
    slug: "situational-variables",
    ref: "skills/stelow-product-job-to-be-done/references/06-situational-variables.md",
    minWords: 500,
    checks: [
      { kind: "headings", level: 2, startsWith: "Category", min: 5 },
      { kind: "headings", level: 3, startsWith: "Situational factor", min: 10 },
    ],
  },
  {
    slug: "functional-needs",
    ref: "skills/stelow-product-job-to-be-done/references/07-functional-needs.md",
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
    ref: "skills/stelow-product-job-to-be-done/references/08-financial-needs.md",
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
    ref: "skills/stelow-product-job-to-be-done/references/09-emotional-social-jobs.md",
    minWords: 400,
    checks: [
      { kind: "table-columns", names: ["Step", "Job", "Type", "Signal", "Status"] },
      { kind: "table-rows", min: 6 },
    ],
  },
  {
    slug: "job-map-steps",
    ref: "skills/stelow-product-job-to-be-done/references/10-job-map-steps.md",
    minWords: 500,
    checks: [
      { kind: "table-columns", names: ["Step", "Phase", "Executor", "Decider", "Output", "Failure mode", "Status"] },
      { kind: "table-rows", min: 5 },
    ],
  },
  {
    slug: "switch-interview",
    ref: "skills/stelow-product-job-to-be-done/references/11-switch-interview.md",
    minWords: 300,
    checks: [
      { kind: "table-columns", names: ["Stage", "Status"] },
    ],
  },
];

/** Contract for a composite substep slug, or null when unmigrated. */
export function contractForSubstep(slug) {
  return findByKey(JTBD_CONTRACTS, "slug", slug);
}

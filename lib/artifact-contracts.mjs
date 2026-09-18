/**
 * Depth contracts for composite substeps. Enforcement data lives here (owned
 * lib/) while the methodology prose lives upstream in
 * skills/stelow-product-job-to-be-done/references/ (vendored, synced). Each
 * entry mirrors its reference file's "Completeness contract" section — the
 * plugin cites ref + line so drift breaks review, not silently.
 *
 * Check DSL (interpreted by lib/artifact-validation.mjs):
 * - { kind: "min-words", min }
 * - { kind: "headings", level, min, max?, startsWith? }
 * - { kind: "named-headings", level (null = any), names, match }
 * - { kind: "contains", needles }
 * - { kind: "section-items", heading, min }
 * - { kind: "field-blocks", marker, fields, minBlocks }
 * - { kind: "table-rows", min }
 */

export const JTBD_CONTRACTS = [
  {
    slug: "contextual-segmentation",
    ref: "skills/stelow-product-job-to-be-done/references/01-contextual-segmentation.md",
    minWords: 800,
    checks: [
      { kind: "field-blocks", marker: "## ", fields: ["Market:", "Justification:", "Situational factors:", "Desired Outcomes:", "Constraints:"], minBlocks: 8 },
    ],
  },
  {
    slug: "thinking-styles",
    ref: "skills/stelow-product-job-to-be-done/references/02-thinking-styles.md",
    minWords: 900,
    checks: [
      { kind: "headings", level: 2, min: 5, max: 5 },
      { kind: "table-rows", min: 15 },
      { kind: "contains", needles: ["Functional Jobs", "Emotional Jobs", "Social Jobs"] },
    ],
  },
  {
    slug: "jtbd-discovery",
    ref: "skills/stelow-product-job-to-be-done/references/03-jtbd-discovery.md",
    minWords: 600,
    checks: [
      { kind: "named-headings", level: 2, names: ["Rewritten JTBDs", "Contextual JTBDs", "Higher functional JTBDs"], match: "contains" },
      { kind: "section-items", heading: "Contextual JTBDs", min: 20 },
      { kind: "section-items", heading: "Rewritten JTBDs", min: 1 },
      { kind: "section-items", heading: "Higher functional JTBDs", min: 1 },
    ],
  },
  {
    slug: "competitors",
    ref: "skills/stelow-product-job-to-be-done/references/04-competitors.md",
    minWords: 500,
    checks: [
      { kind: "named-headings", level: 2, names: ["Direct Competitors", "Indirect Competitors", "Hidden Competitors", "Key Insights"], match: "contains" },
      { kind: "section-items", heading: "Direct Competitors", min: 3 },
      { kind: "section-items", heading: "Indirect Competitors", min: 3 },
      { kind: "section-items", heading: "Hidden Competitors", min: 3 },
      { kind: "section-items", heading: "Key Insights", min: 3 },
    ],
  },
  {
    slug: "job-actors",
    ref: "skills/stelow-product-job-to-be-done/references/05-job-actors.md",
    minWords: 600,
    checks: [
      {
        kind: "named-headings",
        level: 2,
        names: ["Beneficiary", "Performer", "Provider", "Indirect Beneficiary", "Threatened", "Assistant", "Decision Maker", "Purchaser", "Buyer", "Supervisor", "Influencer", "Expert"],
        match: "exact",
      },
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
      { kind: "headings", level: 4, min: 10 },
      { kind: "field-blocks", marker: "#### ", fields: ["Alternative:", "Justification:", "Score:", "Metrics:", "Current solutions:"], minBlocks: 10 },
      { kind: "table-rows", min: 10 },
    ],
  },
  {
    slug: "financial-needs",
    ref: "skills/stelow-product-job-to-be-done/references/08-financial-needs.md",
    minWords: 1500,
    checks: [
      { kind: "named-headings", level: 2, names: ["30 Raw Success Criteria", "Top 20"], match: "contains" },
      { kind: "section-items", heading: "30 Raw Success Criteria", min: 30 },
      { kind: "headings", level: 4, min: 20 },
      { kind: "field-blocks", marker: "#### ", fields: ["Alternative:", "Justification:", "Score:", "Metrics:", "Current solutions:"], minBlocks: 20 },
    ],
  },
  {
    slug: "emotional-social-jobs",
    ref: "skills/stelow-product-job-to-be-done/references/09-emotional-social-jobs.md",
    minWords: 400,
    checks: [
      { kind: "named-headings", level: null, names: ["Emotional Jobs", "Social Jobs"], match: "contains" },
      { kind: "section-items", heading: "Emotional Jobs", min: 5 },
      { kind: "section-items", heading: "Social Jobs", min: 5 },
    ],
  },
  {
    slug: "job-map-steps",
    ref: "skills/stelow-product-job-to-be-done/references/10-job-map-steps.md",
    minWords: 500,
    checks: [
      {
        kind: "named-headings",
        level: 1,
        names: ["Define and Plan", "Prepare and Execute", "Evaluate and Adjust", "Conclude and Organize", "Document and Share", "Monitor subsequent effects"],
        match: "contains",
      },
      { kind: "headings", level: 3, min: 12 },
    ],
  },
];

/** Contract for a composite substep slug, or null when unmigrated. */
export function contractForSubstep(slug) {
  if (typeof slug !== "string" || !slug) return null;
  return JTBD_CONTRACTS.find((entry) => entry.slug === slug) ?? null;
}

/**
 * Primary-file contracts per research strategy id. Composite JTBD's primary
 * is the integrated output (light floor — depth lives in its substeps);
 * variant strategies carry `variants` and pass when ANY variant passes.
 * Each ref cites the upstream skill section the numbers mirror.
 */
export const STRATEGY_CONTRACTS = [
  {
    id: "job-to-be-done",
    ref: "skills/stelow-product-job-to-be-done/SKILL.md",
    minWords: 500,
    checks: [{ kind: "headings", level: null, min: 2 }],
  },
  {
    id: "business-models",
    ref: "skills/stelow-product-business-models/SKILL.md",
    minWords: 600,
    checks: [
      { kind: "headings", level: null, min: 3 },
      { kind: "contains", needles: ["cost", "revenue", "experiment"] },
    ],
  },
  {
    id: "evolutionary",
    ref: "skills/stelow-product-evolutionary-principles/SKILL.md",
    minWords: 600,
    checks: [
      { kind: "headings", level: null, min: 3 },
      { kind: "contains", needles: ["optionality", "revisit"] },
    ],
  },
  {
    id: "promotions",
    ref: "skills/stelow-product-promotions/SKILL.md",
    minWords: 600,
    checks: [
      { kind: "headings", level: null, min: 3 },
      { kind: "contains", needles: ["offer", "cap", "rollback"] },
    ],
  },
  {
    id: "market-analysis",
    ref: "skills/stelow-product-multi-method-market-analysis/SKILL.md",
    variants: [
      {
        minWords: 800,
        checks: [
          { kind: "headings", level: null, min: 6 },
          { kind: "contains", needles: ["PESTLE", "Foresight", "Delphi", "Wardley"] },
        ],
      },
      {
        minWords: 500,
        checks: [
          { kind: "named-headings", level: null, names: ["Executive Summary", "Top Announcements", "Key Insights", "Competitive Snapshot", "Foresight Signals", "Wardley", "Recommended Actions", "Sources"], match: "contains" },
          { kind: "table-rows", min: 3 },
          { kind: "contains", needles: ["mermaid", "Commodity"] },
        ],
      },
    ],
  },
  {
    id: "marketplace",
    ref: "skills/stelow-product-marketplace-playbook/SKILL.md",
    minWords: 600,
    checks: [
      { kind: "headings", level: null, min: 3 },
      { kind: "contains", needles: ["tactic", "constraint"] },
    ],
  },
  {
    id: "open-source",
    ref: "skills/stelow-product-open-source/SKILL.md",
    minWords: 600,
    checks: [
      { kind: "headings", level: null, min: 3 },
      { kind: "contains", needles: ["thesis", "moat", "experiment"] },
    ],
  },
  {
    id: "opportunity-mapping",
    ref: "skills/stelow-product-opportunity-mapping/SKILL.md",
    minWords: 1200,
    checks: [
      { kind: "headings", level: 2, contains: "OPPORTUNITY", min: 3 },
      { kind: "headings", level: 3, contains: "SOLUTION", min: 12 },
      { kind: "contains", needles: ["Time Appetite"] },
    ],
  },
  {
    id: "paywall",
    ref: "skills/stelow-product-paywall/SKILL.md",
    variants: [
      {
        minWords: 600,
        checks: [
          { kind: "headings", level: null, min: 3 },
          { kind: "contains", needles: ["benchmark", "verdict"] },
        ],
      },
      {
        minWords: 600,
        checks: [
          { kind: "headings", level: null, min: 3 },
          { kind: "contains", needles: ["onboarding", "trial", "paywall"] },
        ],
      },
    ],
  },
  {
    id: "pricing",
    ref: "skills/stelow-product-pricing/SKILL.md",
    minWords: 600,
    checks: [
      { kind: "headings", level: null, min: 3 },
      { kind: "contains", needles: ["metric", "guardrail", "perception"] },
    ],
  },
  {
    id: "ads",
    ref: "skills/stelow-product-ads/SKILL.md",
    minWords: 500,
    checks: [
      { kind: "headings", level: null, min: 5 },
      { kind: "contains", needles: ["awareness", "kill criteria"] },
    ],
  },
  {
    id: "discovery",
    ref: "skills/stelow-product-discovery/SKILL.md",
    minWords: 600,
    checks: [
      { kind: "headings", level: null, min: 3 },
      { kind: "contains", needles: ["experiment", "threshold"] },
    ],
  },
  {
    id: "product-health",
    ref: "skills/stelow-product-health/SKILL.md",
    minWords: 500,
    checks: [
      { kind: "headings", level: null, min: 3 },
      { kind: "contains", needles: ["tension", "verdict", "metric"] },
    ],
  },
  {
    id: "trust-building",
    ref: "skills/stelow-product-trust-building/SKILL.md",
    minWords: 500,
    checks: [
      { kind: "headings", level: null, min: 3 },
      { kind: "contains", needles: ["guarantee"] },
    ],
  },
];

/** Primary-file contract for a strategy id, or null when unmigrated. */
export function contractForStrategy(id) {
  if (typeof id !== "string" || !id) return null;
  return STRATEGY_CONTRACTS.find((entry) => entry.id === id) ?? null;
}

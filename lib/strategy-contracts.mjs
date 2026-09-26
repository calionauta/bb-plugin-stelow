/**
 * Primary-file contracts per research strategy id. Composite JTBD's primary is
 * the integrated output (light floor — depth lives in its substeps); variant
 * strategies carry `variants` and pass when ANY variant passes. Each ref cites
 * the upstream skill section the numbers mirror. Interpreted by
 * lib/artifact-validation.mjs.
 */
import { findByKey } from "./artifact-contract-lookup.mjs";

/** A strategy whose primary file is a guided section list plus required terms. */
function guided(id, ref, minWords, headingCount, terms) {
  return {
    id,
    ref,
    minWords,
    checks: [
      { kind: "headings", level: null, min: headingCount },
      { kind: "contains", needles: terms },
    ],
  };
}

const CANVAS_SECTIONS = [
  "Executive Summary",
  "Top Announcements",
  "Key Insights",
  "Competitive Snapshot",
  "Foresight Signals",
  "Wardley",
  "Recommended Actions",
  "Sources",
];

export const STRATEGY_CONTRACTS = [
  guided("job-to-be-done", "skills/stelow-product-job-to-be-done/SKILL.md", 500, 2, []),
  guided(
    "business-models",
    "skills/stelow-product-business-models/SKILL.md",
    600,
    3,
    ["cost", "revenue", "experiment"],
  ),
  guided(
    "evolutionary",
    "skills/stelow-product-evolutionary-principles/SKILL.md",
    600,
    3,
    ["optionality", "revisit"],
  ),
  guided(
    "promotions",
    "skills/stelow-product-promotions/SKILL.md",
    600,
    3,
    ["offer", "cap", "rollback"],
  ),
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
          { kind: "named-headings", level: null, names: CANVAS_SECTIONS, match: "contains" },
          { kind: "table-rows", min: 3 },
          { kind: "contains", needles: ["mermaid", "Commodity"] },
        ],
      },
    ],
  },
  guided(
    "marketplace",
    "skills/stelow-product-marketplace-playbook/SKILL.md",
    600,
    3,
    ["tactic", "constraint"],
  ),
  guided("open-source", "skills/stelow-product-open-source/SKILL.md", 600, 3, ["thesis", "moat", "experiment"]),
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
  guided(
    "pricing",
    "skills/stelow-product-pricing/SKILL.md",
    600,
    3,
    ["metric", "guardrail", "perception"],
  ),
  guided("ads", "skills/stelow-product-ads/SKILL.md", 500, 5, ["awareness", "kill criteria"]),
  guided("discovery", "skills/stelow-product-discovery/SKILL.md", 600, 3, ["experiment", "threshold"]),
  guided("product-health", "skills/stelow-product-health/SKILL.md", 500, 3, ["tension", "verdict", "metric"]),
  guided("trust-building", "skills/stelow-product-trust-building/SKILL.md", 500, 3, ["guarantee"]),
];

/** Primary-file contract for a strategy id, or null when unmigrated. */
export function contractForStrategy(id) {
  return findByKey(STRATEGY_CONTRACTS, "id", id);
}

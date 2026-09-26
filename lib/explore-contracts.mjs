/**
 * Explore/build stage contracts. The same eight entries serve Explore cards
 * (`explore-<stage>.md`, keyed by technique id) and Build documents (matched
 * by filename/title via contractForBuildArtifact): a spec-product.md IS the
 * Shape Up proposal structure, a spec-tech.md IS the tech plan output.
 * Interpreted by lib/artifact-validation.mjs.
 */
import { findByKey } from "./artifact-contract-lookup.mjs";

const SHAPE_UP_SECTIONS = [
  "unanswered questions",
  "alternatives",
  "problem",
  "solution",
  "dangers",
  "out of scope",
  "Scope Table",
];

const INTERFACE_SECTIONS = ["Work Pattern", "Philosophy", "Trade-Off", "State Coverage"];

const EXECUTION_SECTIONS = ["Summary", "Gap Registry", "Lessons Learned", "Decision"];

export const EXPLORE_CONTRACTS = [
  {
    id: "shape-up",
    ref: "skills/stelow-workflow-shape-up/SKILL.md",
    minWords: 800,
    checks: [
      { kind: "named-headings", level: null, names: SHAPE_UP_SECTIONS, match: "contains" },
      { kind: "table-rows", min: 2 },
      { kind: "contains", needles: ["appetite:", "product_type:"] },
    ],
  },
  {
    id: "interface-alternatives",
    ref: "skills/stelow-workflow-interface-alternatives/SKILL.md",
    minWords: 800,
    checks: [
      { kind: "named-headings", level: null, names: INTERFACE_SECTIONS, match: "contains" },
      { kind: "table-rows", min: 2 },
      { kind: "contains", needles: ["ASCII"] },
    ],
  },
  {
    id: "plan-critique",
    ref: "skills/stelow-workflow-plan-critique/SKILL.md",
    minWords: 600,
    checks: [
      { kind: "contains", needles: ["gaps:", "Executive Summary", "Strengths", "verdict"] },
    ],
  },
  {
    id: "tech-planning",
    ref: "skills/stelow-workflow-tech-planning/SKILL.md",
    minWords: 800,
    checks: [
      { kind: "named-headings", level: null, names: ["Identified Scopes", "Sequence"], match: "contains" },
      { kind: "table-rows", min: 2 },
      { kind: "table-columns", names: ["Task", "Done Criterion"] },
      { kind: "contains", needles: ["Dependencies", "Done Criterion"] },
    ],
  },
  {
    id: "codebase-critique",
    ref: "skills/stelow-workflow-codebase-critique/SKILL.md",
    minWords: 600,
    checks: [
      { kind: "contains", needles: ["Executive Summary", "Strengths"] },
    ],
  },
  {
    id: "ux-critique",
    ref: "skills/stelow-workflow-ux-critique/SKILL.md",
    minWords: 600,
    checks: [
      { kind: "contains", needles: ["Executive Summary", "Strengths", "accessibility"] },
    ],
  },
  {
    id: "testing-ai-code",
    ref: "skills/stelow-workflow-testing-ai-code/SKILL.md",
    minWords: 600,
    checks: [
      { kind: "table-rows", min: 4 },
      { kind: "contains", needles: ["product_type", "Test Scopes", "CI/CD Gates"] },
    ],
  },
  {
    id: "execution-critique",
    ref: "skills/stelow-workflow-execution-critique/SKILL.md",
    minWords: 800,
    checks: [
      { kind: "named-headings", level: null, names: EXECUTION_SECTIONS, match: "contains" },
      { kind: "table-rows", min: 4 },
      { kind: "gap-registry" },
    ],
  },
];

/** Explore contract by technique id, or null when unmigrated. */
export function contractForExplore(stageId) {
  return findByKey(EXPLORE_CONTRACTS, "id", stageId);
}

const BUILD_PATH_RULES = [
  { match: "spec-product", contract: "shape-up" },
  { match: "spec-tech", contract: "tech-planning" },
  { match: "selected-interface", contract: "interface-alternatives" },
  { match: "interfaces_", contract: "interface-alternatives" },
  { match: "proposal-", contract: "interface-alternatives" },
  { match: "testing-strategy", contract: "testing-ai-code" },
  { match: "codebase", contract: "codebase-critique" },
  { match: "live-audit", contract: "ux-critique" },
  { match: "screenshot-audit", contract: "ux-critique" },
  { match: "critique-report", contract: "plan-critique" },
];

const BUILD_TITLE_RULES = [
  { match: "Execution Critique Report", contract: "execution-critique" },
];

/** Markdown basename; every Build match keys off the name, not the directory. */
function buildBaseName(filePath) {
  return String(filePath ?? "").split("/").pop() ?? "";
}

/** Documents that are bookkeeping, not deliverables — they never block. */
function isExcludedBase(base) {
  return base === "audit.md" || base === "state.md" || base.endsWith("-approved.md");
}

/** Explicit critique directories win over the generic `critique-report` rule. */
function critiqueByPath(lower, fullLower) {
  if (fullLower.includes("codebase-critique") || lower.includes("codebase")) return "codebase-critique";
  const auditMarkers = ["ux-critique", "live-audit", "screenshot-audit"];
  if (auditMarkers.some((marker) => fullLower.includes(marker))) return "ux-critique";
  return null;
}

function firstRuleMatch(rules, haystack) {
  for (const rule of rules) {
    if (haystack.includes(rule.match)) return rule.contract;
  }
  return null;
}

/**
 * Stage contract for a Build document by filename, falling back to title
 * markers. Returns null for unknown shapes (audit.md, receipts, state
 * bookkeeping): unrecognized documents never block completion.
 */
export function contractForBuildArtifact(filePath, content) {
  const base = buildBaseName(filePath);
  if (!base.endsWith(".md")) return null;
  if (isExcludedBase(base)) return null;
  const lower = base.toLowerCase();
  const critique = critiqueByPath(lower, String(filePath ?? "").toLowerCase());
  if (critique) return contractForExplore(critique);
  const byName = firstRuleMatch(BUILD_PATH_RULES, lower);
  if (byName) return contractForExplore(byName);
  const body = typeof content === "string" ? content : "";
  const byTitle = firstRuleMatch(BUILD_TITLE_RULES, body);
  return byTitle ? contractForExplore(byTitle) : null;
}

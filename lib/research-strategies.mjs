/**
 * Research strategies for the Stelow Research track. Each entry maps to one
 * stelow-product-* playbook (resolved through the agent skills hub, same as
 * the delivery worker prompt references). Single source of truth for the
 * strategy picker and the research worker prompt. Ordered alphabetically by
 * label so the picker scans predictably. `emoji` is the strategy's visual
 * identity in the picker (user-requested); `keywords` feed the picker's
 * filter index alongside id, label, and blurb.
 */
import { normalizeHistory } from "./research-rounds.mjs";

export const RESEARCH_STRATEGIES = [
  { id: "business-models", label: "Business models", skill: "stelow-product-business-models", blurb: "Cost and revenue model triggers to adapt and experiment.", emoji: "💼", keywords: ["revenue", "cost", "monetiz"], contract: "single" },
  { id: "evolutionary", label: "Evolutionary strategy", skill: "stelow-product-evolutionary-principles", blurb: "Adaptability, optionality, and experimentation beyond fixed roadmaps.", emoji: "🧬", keywords: ["evo", "optionality", "adapt"], contract: "single" },
  { id: "job-to-be-done", label: "Jobs to be done", skill: "stelow-product-job-to-be-done", blurb: "Segmentation, job map, desired outcomes, emotional and social jobs.", emoji: "🎯", keywords: ["jtbd", "jobs", "outcomes"], contract: "composite", substeps: ["contextual-segmentation", "thinking-styles", "jtbd-discovery", "competitors", "job-actors", "situational-variables", "functional-needs", "financial-needs", "emotional-social-jobs", "job-map-steps"] },
  { id: "promotions", label: "Launch promotions", skill: "stelow-product-promotions", blurb: "MAGIC launch offers: loss leader, gift cards, irresistible freebies.", emoji: "🎁", keywords: ["promo", "magic", "launch", "gift"], contract: "single" },
  { id: "market-analysis", label: "Market analysis", skill: "stelow-product-multi-method-market-analysis", blurb: "PESTLE, foresight, Delphi, and Wardley maps on a market or niche.", emoji: "🔭", keywords: ["pestle", "foresight", "delphi", "wardley", "market"], contract: "variant" },
  { id: "marketplace", label: "Marketplace playbook", skill: "stelow-product-marketplace-playbook", blurb: "Supply/demand tactics for stimulating marketplaces.", emoji: "🏪", keywords: ["supply", "demand"], contract: "single" },
  { id: "open-source", label: "Open source strategy", skill: "stelow-product-open-source", blurb: "Value delivery by giving up control; models and moats.", emoji: "🔓", keywords: ["oss", "moat", "control"], contract: "single" },
  { id: "opportunity-mapping", label: "Opportunity mapping", skill: "stelow-product-opportunity-mapping", blurb: "Ranked solutions for a problem, from ranked opportunities to bets.", emoji: "🗺️", keywords: ["opp", "bets", "ranked", "solutions"], contract: "single" },
  { id: "paywall", label: "Paywall & onboarding", skill: "stelow-product-paywall", blurb: "Consumer-app monetization funnel, from paywall to trial policy.", emoji: "🎟️", keywords: ["pay", "trial", "onboarding", "funnel"], contract: "single" },
  { id: "pricing", label: "Pricing", skill: "stelow-product-pricing", blurb: "Exchange bases, consumption control, and value perception.", emoji: "💰", keywords: ["price", "packaging", "consumption"], contract: "single" },
  { id: "ads", label: "Product ads", skill: "stelow-product-ads", blurb: "Awareness-stage ad categories on the transtheoretical model.", emoji: "📣", keywords: ["awareness", "ads"], contract: "single" },
  { id: "discovery", label: "Product discovery", skill: "stelow-product-discovery", blurb: "Short-cycle validation: idea, early adopters, MVP, first sale.", emoji: "🧪", keywords: ["mvp", "validation", "early adopters", "first sale"], contract: "single" },
  { id: "product-health", label: "Product health", skill: "stelow-product-health", blurb: "Success signals in tension with counterbalance signals.", emoji: "💓", keywords: ["health", "signals"], contract: "single" },
  { id: "trust-building", label: "Trust building", skill: "stelow-product-trust-building", blurb: "Perception pillars and guarantees that materialize trust.", emoji: "🤝", keywords: ["trust", "guarantee"], contract: "single" },
];

export function researchStrategyById(id) {
  return RESEARCH_STRATEGIES.find((entry) => entry.id === id) ?? null;
}

/**
 * Expected suboutput slugs for a strategy round, or [] when the contract
 * needs no validation (single/variant). Only `composite` names substeps.
 */
export function expectedSubsteps(strategyId) {
  const entry = researchStrategyById(strategyId);
  if (!entry || entry.contract !== "composite") return [];
  return Array.isArray(entry.substeps) ? [...entry.substeps] : [];
}

/**
 * Which expected substeps are absent from the present slugs. Empty means
 * complete (or nothing to validate). Reported explicitly — never silently
 * treated as done.
 */
export function missingSubsteps(strategyId, presentSlugs) {
  const expected = expectedSubsteps(strategyId);
  if (expected.length === 0) return [];
  const present = new Set((presentSlugs ?? []).map(String));
  return expected.filter((slug) => !present.has(slug));
}

/**
 * Ordered strategy ids for a research card. History rows are {id, at, file}
 * objects (see lib/research-rounds.mjs); this projection keeps id-only
 * consumers unchanged.
 */
export function parseStrategyList(raw) {
  return normalizeHistory(raw).map((entry) => entry.id);
}
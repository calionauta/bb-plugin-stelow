/**
 * Research strategies for the Stelow Research track. Each entry maps to one
 * stelow-product-* playbook (resolved through the agent skills hub, same as
 * the delivery worker prompt references). Single source of truth for the
 * strategy picker and the research worker prompt. Ordered alphabetically by
 * label so the picker scans predictably. `emoji` is the strategy's visual
 * identity in the picker (user-requested); `keywords` feed the picker's
 * filter index alongside id, label, and blurb.
 */
export const RESEARCH_STRATEGIES = [
  { id: "business-models", label: "Business models", skill: "stelow-product-business-models", blurb: "Cost and revenue model triggers to adapt and experiment.", emoji: "💼", keywords: ["revenue", "cost", "monetiz"] },
  { id: "evolutionary", label: "Evolutionary strategy", skill: "stelow-product-evolutionary-principles", blurb: "Adaptability, optionality, and experimentation beyond fixed roadmaps.", emoji: "🧬", keywords: ["evo", "optionality", "adapt"] },
  { id: "job-to-be-done", label: "Jobs to be done", skill: "stelow-product-job-to-be-done", blurb: "Segmentation, job map, desired outcomes, emotional and social jobs.", emoji: "🎯", keywords: ["jtbd", "jobs", "outcomes"] },
  { id: "promotions", label: "Launch promotions", skill: "stelow-product-promotions", blurb: "MAGIC launch offers: loss leader, gift cards, irresistible freebies.", emoji: "🎁", keywords: ["promo", "magic", "launch", "gift"] },
  { id: "market-analysis", label: "Market analysis", skill: "stelow-product-multi-method-market-analysis", blurb: "PESTLE, foresight, Delphi, and Wardley maps on a market or niche.", emoji: "🔭", keywords: ["pestle", "foresight", "delphi", "wardley", "market"] },
  { id: "marketplace", label: "Marketplace playbook", skill: "stelow-product-marketplace-playbook", blurb: "Supply/demand tactics for stimulating marketplaces.", emoji: "🏪", keywords: ["supply", "demand"] },
  { id: "open-source", label: "Open source strategy", skill: "stelow-product-open-source", blurb: "Value delivery by giving up control; models and moats.", emoji: "🔓", keywords: ["oss", "moat", "control"] },
  { id: "opportunity-mapping", label: "Opportunity mapping", skill: "stelow-product-opportunity-mapping", blurb: "Ranked solutions for a problem, from ranked opportunities to bets.", emoji: "🗺️", keywords: ["opp", "bets", "ranked", "solutions"] },
  { id: "paywall", label: "Paywall & onboarding", skill: "stelow-product-paywall", blurb: "Consumer-app monetization funnel, from paywall to trial policy.", emoji: "🎟️", keywords: ["pay", "trial", "onboarding", "funnel"] },
  { id: "pricing", label: "Pricing", skill: "stelow-product-pricing", blurb: "Exchange bases, consumption control, and value perception.", emoji: "💰", keywords: ["price", "packaging", "consumption"] },
  { id: "ads", label: "Product ads", skill: "stelow-product-ads", blurb: "Awareness-stage ad categories on the transtheoretical model.", emoji: "📣", keywords: ["awareness", "ads"] },
  { id: "discovery", label: "Product discovery", skill: "stelow-product-discovery", blurb: "Short-cycle validation: idea, early adopters, MVP, first sale.", emoji: "🧪", keywords: ["mvp", "validation", "early adopters", "first sale"] },
  { id: "product-health", label: "Product health", skill: "stelow-product-health", blurb: "Success signals in tension with counterbalance signals.", emoji: "💓", keywords: ["health", "signals"] },
  { id: "trust-building", label: "Trust building", skill: "stelow-product-trust-building", blurb: "Perception pillars and guarantees that materialize trust.", emoji: "🤝", keywords: ["trust", "guarantee"] },
];

export function researchStrategyById(id) {
  return RESEARCH_STRATEGIES.find((entry) => entry.id === id) ?? null;
}

/**
 * Ordered strategy history for a research card. Stored as a JSON array in
 * research_strategies; older rows carry only the single research_strategy
 * id, which reads as a one-element history. Repeats are preserved — a
 * repeated id means the user ran another round of the same playbook.
 */
export function parseStrategyList(raw, fallbackId) {
  try {
    const parsed = JSON.parse(raw ?? "[]");
    if (Array.isArray(parsed)) {
      const list = parsed.filter((value) => typeof value === "string" && value.length > 0);
      if (list.length > 0) return list;
    }
  } catch {
    /* fall through to the legacy single id */
  }
  return typeof fallbackId === "string" && fallbackId.length > 0 ? [fallbackId] : [];
}
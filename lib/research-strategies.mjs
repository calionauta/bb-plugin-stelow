/**
 * Research strategies for the Stelow Research track. Each entry maps to one
 * stelow-product-* playbook (resolved through the agent skills hub, same as
 * the delivery worker prompt references). Single source of truth for the
 * strategy picker and the research worker prompt. Ordered alphabetically by
 * label so the picker scans predictably; the creation form still defaults
 * to opportunity-mapping as the recommended starting point.
 */
export const RESEARCH_STRATEGIES = [
  { id: "business-models", label: "Business models", skill: "stelow-product-business-models", blurb: "Cost and revenue model triggers to adapt and experiment." },
  { id: "evolutionary", label: "Evolutionary strategy", skill: "stelow-product-evolutionary-principles", blurb: "Adaptability, optionality, and experimentation beyond fixed roadmaps." },
  { id: "job-to-be-done", label: "Jobs to be done", skill: "stelow-product-job-to-be-done", blurb: "Segmentation, job map, desired outcomes, emotional and social jobs." },
  { id: "promotions", label: "Launch promotions", skill: "stelow-product-promotions", blurb: "MAGIC launch offers: loss leader, gift cards, irresistible freebies." },
  { id: "market-analysis", label: "Market analysis", skill: "stelow-product-multi-method-market-analysis", blurb: "PESTLE, foresight, Delphi, and Wardley maps on a market or niche." },
  { id: "marketplace", label: "Marketplace playbook", skill: "stelow-product-marketplace-playbook", blurb: "Supply/demand tactics for stimulating marketplaces." },
  { id: "open-source", label: "Open source strategy", skill: "stelow-product-open-source", blurb: "Value delivery by giving up control; models and moats." },
  { id: "opportunity-mapping", label: "Opportunity mapping", skill: "stelow-product-opportunity-mapping", blurb: "Ranked solutions for a problem, from ranked opportunities to bets." },
  { id: "paywall", label: "Paywall & onboarding", skill: "stelow-product-paywall", blurb: "Consumer-app monetization funnel, from paywall to trial policy." },
  { id: "pricing", label: "Pricing", skill: "stelow-product-pricing", blurb: "Exchange bases, consumption control, and value perception." },
  { id: "ads", label: "Product ads", skill: "stelow-product-ads", blurb: "Awareness-stage ad categories on the transtheoretical model." },
  { id: "discovery", label: "Product discovery", skill: "stelow-product-discovery", blurb: "Short-cycle validation: idea, early adopters, MVP, first sale." },
  { id: "product-health", label: "Product health", skill: "stelow-product-health", blurb: "Success signals in tension with counterbalance signals." },
  { id: "trust-building", label: "Trust building", skill: "stelow-product-trust-building", blurb: "Perception pillars and guarantees that materialize trust." },
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
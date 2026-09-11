// A Build card's type selects its stage route. Keep editing and reclassification
// rules shared so the UI cannot offer a mutation the server must reject.
function isBuildWorkflowCard(card) {
  return card?.kind === "build";
}

const FRESH_STATUS_BY_KIND = { research: "pending", explore: "pending" };

export function canEditWorkflowIntent(card) {
  return isBuildWorkflowCard(card) && card.stage === "triage" && card.status !== "archived";
}

export function canReclassifyWorkflow(card) {
  return isBuildWorkflowCard(card) && card.stage !== "triage" && card.status !== "archived";
}

export function resolveReseedIntent(card, requestedIntent) {
  if (requestedIntent && !isBuildWorkflowCard(card)) return null;
  const intent = requestedIntent ?? card.intent;
  return { intent, reclassified: intent !== card.intent };
}

export function freshStatusForReseed(card, reclassified) {
  return FRESH_STATUS_BY_KIND[card.kind] ?? (reclassified ? "draft" : card.status);
}

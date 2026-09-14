import { SPLIT_KEEP_LABEL } from "./split-proposal.mjs";

export const SPLIT_QUESTION_GUIDANCE = "Select one or more deliveries to create independent cards. Anything you leave unselected remains in this card. If you select every delivery, this card is archived after the new cards are created.";

const LEGACY_PROMPTS = [
  SPLIT_QUESTION_GUIDANCE,
  "Select the deliveries that should become new independent cards. Anything you do not select stays in this card; nothing is discarded. Choose \"Keep as one card\" to keep the entire request together.",
  "Select any deliveries to move into separate cards. Work you leave unselected stays in this card.",
];
const GENERATED_OPTION_SUFFIX = /\n\n(?:Selecting this creates one independent card for this delivery; unselected deliveries remain in this card\.|Keep the complete request in this card\. No new cards will be created\.|Creates one independent card for this delivery\.|Keep every delivery in this card\. No new cards will be created\.)\s*$/;

export function isSplitQuestion(question) {
  // `kind` is the forward-compatible semantic discriminator. The option
  // fallback keeps already-persisted questions safe after an upgrade.
  return question?.kind === "split" || (Boolean(question?.multiple) && Array.isArray(question?.options)
    && question.options.some((option) => option?.label === SPLIT_KEEP_LABEL));
}

// A previously persisted ask must render with current, non-duplicated copy.
// Keep the worker's original question but replace only the host-generated
// ending; author-written paragraphs are never flattened or removed.
export function splitQuestionText(question) {
  let base = typeof question === "string" ? question.trim() : "";
  for (const legacy of LEGACY_PROMPTS) {
    if (base.endsWith(legacy)) base = base.slice(0, -legacy.length).trim();
  }
  return base ? `${base}\n\n${SPLIT_QUESTION_GUIDANCE}` : SPLIT_QUESTION_GUIDANCE;
}

export function splitOptionDescription(description) {
  return (typeof description === "string" ? description : "").replace(GENERATED_OPTION_SUFFIX, "");
}

// Feedback belongs beside the selection that changes the parent-card fate,
// not only in static explanatory copy above the options.
export function splitSelectionNotice(options, selected) {
  const deliveries = (Array.isArray(options) ? options : [])
    .map((option) => option?.label)
    .filter((label) => typeof label === "string" && label !== SPLIT_KEEP_LABEL);
  const picks = new Set((Array.isArray(selected) ? selected : []).filter((label) => typeof label === "string"));
  if (picks.has(SPLIT_KEEP_LABEL)) {
    return { kind: "keep", text: "Keeping one card: no child cards will be created and this card stays active." };
  }
  const selectedDeliveries = deliveries.filter((label) => picks.has(label));
  if (selectedDeliveries.length === 0) return null;
  if (deliveries.length > 0 && selectedDeliveries.length === deliveries.length) {
    return { kind: "archive", text: `All ${deliveries.length} deliveries are selected. Submitting will create ${deliveries.length} child cards and archive this card.` };
  }
  return { kind: "partial", text: `${selectedDeliveries.length} ${selectedDeliveries.length === 1 ? "delivery" : "deliveries"} will become child cards; this card stays active with the remaining work.` };
}

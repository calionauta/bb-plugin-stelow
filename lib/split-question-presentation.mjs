import { SPLIT_KEEP_LABEL } from "./split-proposal.mjs";

export const SPLIT_QUESTION_GUIDANCE = "Select one or more deliveries to create independent cards. Anything you leave unselected remains in this card. If you select every delivery, this card is archived after the new cards are created.";

const LEGACY_PROMPTS = [
  "Select the deliveries that should become new independent cards. Anything you do not select stays in this card; nothing is discarded. Choose \"Keep as one card\" to keep the entire request together.",
  "Select any deliveries to move into separate cards. Work you leave unselected stays in this card.",
];
const GENERATED_OPTION_SUFFIX = /\n\n(?:Selecting this creates one independent card for this delivery; unselected deliveries remain in this card\.|Keep the complete request in this card\. No new cards will be created\.|Creates one independent card for this delivery\.|Keep every delivery in this card\. No new cards will be created\.)\s*$/;

export function isSplitQuestion(question) {
  return Boolean(question?.multiple) && Array.isArray(question?.options)
    && question.options.some((option) => option?.label === SPLIT_KEEP_LABEL);
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

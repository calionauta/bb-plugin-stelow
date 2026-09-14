import { SPLIT_KEEP_LABEL } from "./split-proposal.mjs";
import { questionLocale } from "./question-presentation.mjs";

export const SPLIT_QUESTION_GUIDANCE = "Select one or more deliveries to create independent cards. Anything you leave unselected remains in this card. If you select every delivery, this card is archived after the new cards are created.";
const SPLIT_QUESTION_GUIDANCE_PT = "Selecione um ou mais entregáveis para criar cards independentes. O que ficar desmarcado continua neste card. Se você selecionar todos, este card será arquivado após os novos cards serem criados.";

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
export function splitQuestionText(question, options = [], locale = null) {
  let base = typeof question === "string" ? question.trim() : "";
  for (const legacy of LEGACY_PROMPTS) {
    if (base.endsWith(legacy)) base = base.slice(0, -legacy.length).trim();
  }
  // Earlier workers phrased the Portuguese prompt in terms of what should
  // remain, while the controls select what should split. Repair that known
  // contradiction at display time without touching answer identities.
  base = base.replace(/Quais devem permanecer neste card\?/i, "Quais devem virar cards independentes?");
  const guidance = questionLocale(locale, base, options) === "pt-BR" ? SPLIT_QUESTION_GUIDANCE_PT : SPLIT_QUESTION_GUIDANCE;
  return base ? `${base}\n\n${guidance}` : guidance;
}

export function splitOptionDescription(description) {
  return (typeof description === "string" ? description : "").replace(GENERATED_OPTION_SUFFIX, "");
}

// Feedback belongs beside the selection that changes the parent-card fate,
// not only in static explanatory copy above the options.
export function splitSelectionNotice(question, options, selected, locale = null) {
  const deliveries = (Array.isArray(options) ? options : [])
    .map((option) => option?.label)
    .filter((label) => typeof label === "string" && label !== SPLIT_KEEP_LABEL);
  const picks = new Set((Array.isArray(selected) ? selected : []).filter((label) => typeof label === "string"));
  const portuguese = questionLocale(locale, question, options) === "pt-BR";
  if (picks.has(SPLIT_KEEP_LABEL)) {
    return { kind: "keep", text: portuguese ? "Manter em um card: nenhum card novo será criado e este card continua ativo." : "Keeping one card: no child cards will be created and this card stays active." };
  }
  const selectedDeliveries = deliveries.filter((label) => picks.has(label));
  if (selectedDeliveries.length === 0) return null;
  if (deliveries.length > 0 && selectedDeliveries.length === deliveries.length) {
    return { kind: "archive", text: portuguese ? `Todos os ${deliveries.length} entregáveis foram selecionados. Ao enviar, ${deliveries.length} novos cards serão criados e este card será arquivado.` : `All ${deliveries.length} deliveries are selected. Submitting will create ${deliveries.length} child cards and archive this card.` };
  }
  return { kind: "partial", text: portuguese ? `${selectedDeliveries.length} ${selectedDeliveries.length === 1 ? "entregável será criado como card independente;" : "entregáveis serão criados como cards independentes;"} este card continua ativo com o trabalho restante.` : `${selectedDeliveries.length} ${selectedDeliveries.length === 1 ? "delivery" : "deliveries"} will become child cards; this card stays active with the remaining work.` };
}

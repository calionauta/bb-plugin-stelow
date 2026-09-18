/**
 * Evidence honesty for research cards. The worker prompt already requires the
 * worker to declare missing web tools in research-index.md instead of
 * fabricating findings; this module reads that declaration back so the host
 * can cap the card at hypothesis-only. Detection keys off the worker's own
 * words (both languages the prompt permits), never off model judgment about
 * source quality.
 */

/** Phrases through which a worker declares web research was unavailable. */
export const NO_WEB_PATTERNS = [
  /web (search|research) (tools? )?(was|were|is) unavailable/i,
  /busca web indispon[íi]vel/i,
  /ferramenta de busca web indispon[íi]vel/i,
  /no web search (tools? )?available/i,
  /sem (acesso a |ferramenta de )?busca web/i,
  /search tools? (not|un)available/i,
];

/** True when the index declares web research was unavailable this round. */
export function declaresNoWebEvidence(indexMarkdown) {
  const body = typeof indexMarkdown === "string" ? indexMarkdown : "";
  if (!body.trim()) return false;
  return NO_WEB_PATTERNS.some((pattern) => pattern.test(body));
}

/**
 * Evidence status for a research index: hypothesis-only when the worker
 * declared web research unavailable, verified otherwise. A hypothesis-only
 * card may exist and complete structurally, but must never be announced as
 * complete research.
 */
export function evidenceStatus(indexMarkdown) {
  return declaresNoWebEvidence(indexMarkdown) ? "hypothesis-only" : "verified";
}

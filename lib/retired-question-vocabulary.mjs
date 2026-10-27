/**
 * Vocabulary the workflow retired, refused before a question can reach a card.
 *
 * `appetite` was the old calendar-bound depth ladder. The config now carries
 * `quality` (production | experimental) and the exploration breadth knobs, and
 * the methodology maps an `appetite:` line once on read so old state files keep
 * working. A worker that still asks "is this bigger than the appetite?" is
 * comparing the work against a setting no config in this host exposes, so the
 * human cannot answer the question as written.
 *
 * The guard lives in host code rather than only in the skills because the
 * skills are synced from upstream and can lag a host release. It names the
 * replacement so the worker's retry can succeed, and it reads option labels
 * and descriptions too — the retired word in an option is the same stale
 * question in a smaller box.
 */
const RETIRED_QUESTION_VOCABULARY = [
  {
    term: /\bappetite\b/i,
    replacement: "the declared quality and exploration knobs",
  },
];

export function retiredQuestionVocabularyError(question, options = []) {
  const content = [question, ...(Array.isArray(options) ? options.flatMap((option) => [option?.label, option?.description]) : [])]
    .filter((value) => typeof value === "string")
    .join("\n");
  const hit = RETIRED_QUESTION_VOCABULARY.find(({ term }) => term.test(content));
  if (!hit) return null;
  const word = content.match(hit.term)?.[0] ?? "appetite";
  return `Structured card questions must not use the retired "${word}" vocabulary. `
    + `Say ${hit.replacement} instead (the config no longer exposes an appetite), then retry once.`;
}

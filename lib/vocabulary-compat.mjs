/**
 * Vocabulary freeze: one canonical list, one compat map.
 *
 * Canonical (frozen): stage, scope, question, preset.
 * Every other workflow noun the codebase ever used for the same ideas —
 * track, trackable, phase, step, ask, gate, task, handler — resolves through
 * exactly this map and nowhere else. No other module may carry its own
 * ladder/alias table for these words.
 */

export const CANONICAL_VOCABULARY = Object.freeze(["stage", "scope", "question", "preset"]);

/**
 * Legacy -> canonical. Rationale per entry:
 * - track/phase/step -> stage (a position in the stage sequence; TRACK_BANDS,
 *   STAGE_BANDS and "phase columns" all name stage membership).
 * - trackable/task -> scope (trackables.mjs kinds; task rows live under a
 *   scope contract, scopes/{id}.json, and advance only on scope state).
 * - ask/gate -> question (ask-* modules and gate/review-gates name the same
 *   pending-question rows the inbox resolves as questions).
 * - handler -> preset (execution handlers resolve their band preset; the
 *   handler never owns vocabulary, the preset it runs on does).
 */
export const VOCABULARY_COMPAT = Object.freeze({
  track: "stage",
  trackable: "scope",
  phase: "stage",
  step: "stage",
  ask: "question",
  gate: "question",
  task: "scope",
  handler: "preset",
});

export function isCanonicalTerm(term) {
  return typeof term === "string" && CANONICAL_VOCABULARY.includes(term);
}

/** Legacy term -> canonical term; canonical and unknown terms pass through. */
export function normalizeVocabularyTerm(term) {
  if (typeof term !== "string" || !term) return term;
  return Object.hasOwn(VOCABULARY_COMPAT, term) ? VOCABULARY_COMPAT[term] : term;
}

/**
 * Scope IDs (A5, S12, …) are worker vocabulary: stable, short, and
 * meaningless to a person. Question copy addressed to a human must use
 * titles and outcomes; the IDs stay in artifacts and receipts where the
 * worker reads them.
 *
 * Templates already tell workers to lead with titles. These helpers are the
 * display-side safety net: at render time, any ID that slipped into
 * question, label, description, or preview copy renders as its title. IDs
 * with no known title pass through untouched — an unmapped token is data,
 * and dropping it would be the worse lie. Receipts, contracts, staleness,
 * and the answer doors all keep the exact worker text: this changes what
 * the person reads, never what the machine matches.
 */

export function scopeTitleIndex(entries) {
  const index = new Map();
  for (const entry of Array.isArray(entries) ? entries : []) {
    const id = typeof entry?.id === "string" ? entry.id.trim() : "";
    if (!id || index.has(id)) continue;
    const title = [entry?.title, entry?.name, entry?.outcome]
      .find((value) => typeof value === "string" && value.trim());
    if (title) index.set(id, title.trim());
  }
  return index;
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function replaceScopeIds(text, index) {
  if (typeof text !== "string" || !(index instanceof Map) || index.size === 0) return text;
  const pattern = [...index.keys()]
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp)
    .join("|");
  return text.replace(
    new RegExp(`\\b(${pattern})\\b`, "g"),
    (match) => index.get(match) ?? match,
  );
}

export function applyScopeLabels(question, index) {
  if (!question || typeof question !== "object") return question;
  const labeled = { ...question };
  if (typeof labeled.question === "string") labeled.question = replaceScopeIds(labeled.question, index);
  if (Array.isArray(labeled.options)) {
    labeled.options = labeled.options.map((option) => {
      if (!option || typeof option !== "object") return option;
      const next = { ...option };
      for (const field of ["label", "description", "preview"]) {
        if (typeof next[field] === "string") next[field] = replaceScopeIds(next[field], index);
      }
      return next;
    });
  }
  return labeled;
}

/**
 * Display-only scope-ID → title mapping for one detail read. The index
 * draws from the approved map, the draft, and the tracking scopes — first
 * title wins — so a straggler ID resolves however the card currently knows
 * it. Receipts, contracts, staleness, and the answer doors all keep the
 * exact worker text: this changes what the person reads, never what the
 * machine matches.
 */
export function labelDetailQuestions(pending, expired, xray, draft, scopes) {
  const index = scopeTitleIndex([
    ...(xray && Array.isArray(xray.nodes) ? xray.nodes : []),
    ...(draft && Array.isArray(draft.nodes) ? draft.nodes : []),
    ...(Array.isArray(scopes) ? scopes : []),
  ]);
  const labeled = (questions) => (
    Array.isArray(questions) ? questions : []
  ).map((question) => applyScopeLabels(question, index));
  return { pending: labeled(pending), expired: labeled(expired) };
}

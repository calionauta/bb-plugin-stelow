// Card-split proposal rules (pure, tested). A triage worker that finds 2+
// clearly independent items in one card proposes the split through a
// structured ask; the host creates the children only from an approved,
// recorded proposal — never from a worker's claim.
//
// Shape discipline (mirrors fan-out: IDs, never prose):
// - slices come from ask options (label + description), recorded by the host
//   at ask time; selections are recorded by the host from the submitted
//   answer (ask-handler return AND card-answer RPC — both land here);
// - `bb stelow split` takes no content args: it executes the recorded,
//   approved proposal or refuses.

export const SPLIT_KEEP_LABEL = "Keep as one card";
export const MAX_SPLIT_CHILDREN = 5;
export const MIN_SPLIT_CHILDREN = 2;
export const SPLIT_PROPOSAL_TTL_MS = 24 * 60 * 60 * 1000;

function text(value) {
  return typeof value === "string" ? value : "";
}

function norm(label) {
  return text(label).trim().toLowerCase();
}

/**
 * Validate ask-time slices (labels + descriptions, keep option excluded by
 * the caller). Returns an error string or null.
 */
export function validateSplitSlices(slices) {
  if (!Array.isArray(slices) || slices.length < MIN_SPLIT_CHILDREN) {
    return `A split needs at least ${MIN_SPLIT_CHILDREN} proposed cards — fewer is one card with scopes, not a split.`;
  }
  if (slices.length > MAX_SPLIT_CHILDREN) {
    return `A split proposes at most ${MAX_SPLIT_CHILDREN} cards at once — group the rest and propose again.`;
  }
  const seen = new Set();
  for (const slice of slices) {
    const title = text(slice?.title ?? slice?.label);
    if (!title.trim()) return "Every proposed card needs a non-empty title.";
    if (!text(slice?.desc ?? slice?.description).trim()) {
      return `Proposed card "${title.trim()}" needs a scope description — an option without one is not a proposal.`;
    }
    const key = norm(title);
    if (seen.has(key)) return `Proposed card "${title.trim()}" is duplicated — titles must be distinct.`;
    seen.add(key);
  }
  return null;
}

/**
 * Decide what an answered proposal means. `selected` are the submitted
 * option labels (host-recorded). Returns { action, approved, reason }:
 * - "keep": the keep option was picked (veto, even alongside slices);
 * - "split": approved slices to create;
 * - "refuse": nothing actionable (empty, unknown labels).
 */
export function splitOutcome(slices, selected) {
  const titles = new Map((Array.isArray(slices) ? slices : []).map((slice) => [norm(slice?.title ?? slice?.label), slice]));
  const picks = Array.isArray(selected) ? selected.map((label) => text(label)).filter((label) => label.trim().length > 0) : [];
  if (picks.some((label) => norm(label) === norm(SPLIT_KEEP_LABEL))) {
    return { action: "keep", approved: [], reason: "the user chose to keep one card" };
  }
  if (picks.length === 0) {
    return { action: "refuse", approved: [], reason: "no slices were approved — answer the split question first" };
  }
  const unknown = picks.filter((label) => !titles.has(norm(label)));
  if (unknown.length > 0) {
    return { action: "refuse", approved: [], reason: `unknown options cannot become cards: ${unknown.join(", ")} — re-answer the split question` };
  }
  const approved = picks.map((label) => titles.get(norm(label)));
  return { action: "split", approved, reason: `${approved.length} approved ${approved.length === 1 ? "slice" : "slices"}` };
}

/**
 * Split the stored slices into approved vs remaining, for partial approval:
 * the parent archives only when nothing remains.
 */
export function splitRemainder(slices, approved) {
  const approvedKeys = new Set((Array.isArray(approved) ? approved : []).map((slice) => norm(slice?.title ?? slice?.label)));
  const remaining = (Array.isArray(slices) ? slices : []).filter((slice) => !approvedKeys.has(norm(slice?.title ?? slice?.label)));
  return { approved: Array.isArray(approved) ? approved : [], remaining, archiveParent: remaining.length === 0 };
}

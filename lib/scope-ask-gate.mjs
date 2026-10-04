// One tag for scope IN/OUT confirms, so the rule lives in one place.
//
// Scope questions are opt-out confirms (Pattern 3): keep-questions arrive
// with every option checked, add-questions with none, every group multiple,
// chunked at six. On card_a9q5zhzd the same shape arrived as "Keep IN ×7"
// unchecked plus "Add to IN ×4" as radio buttons — three deviations no test
// could name, because nothing marked a question AS a scope confirm. The tag
// is that mark: structural shape is enforced here, and in Auto the whole ask
// is refused (the worker adjusts scope itself and never parks).

/** The machine tag for scope IN/OUT confirms. */
export const SCOPE_ADJUST_TAG = "scope-adjust";

/** Pattern 3 chunks at six options per question; never drop items to fit. */
export const SCOPE_ASK_MAX_OPTIONS = 6;

/**
 * Refuse a malformed scope confirm, or one asked in the wrong mode. Returns
 * the refusal sentence, or null when the ask may proceed. Pure, so the shape
 * the card enforces is pinned without standing up the CLI.
 *
 * `reviewMode` is the workflow's own label ("Auto", "Product Spec Gate",
 * ...); null/unknown fails open — a mode the host cannot read must never
 * block a question, or an unreadable state.md would silence real asks.
 */
export function scopeAskRefusal({ tag, reviewMode, groups }) {
  if (tag !== SCOPE_ADJUST_TAG) return null;
  // Canonical labels are capitalized ("Auto"), but the comparison is
  // case-insensitive on purpose: a lowercase "auto" in state.md evidently
  // means Auto, while an unrecognized label stays unknown and fails open.
  if (typeof reviewMode === "string" && reviewMode.trim().toLowerCase() === "auto") {
    return "Refused: review mode is Auto, where the worker adjusts scope itself and never parks waiting — "
      + "decide which scopes stay IN and proceed (Pattern 3). Re-run with --force to ask anyway.";
  }
  const list = Array.isArray(groups) ? groups : [];
  for (const [index, group] of list.entries()) {
    if (!group || group.multiple !== true) {
      return `Refused: scope question ${index + 1} is single-select — scope confirms are opt-out multi-selects, `
        + "re-run with --multiple so keeping means leaving checked.";
    }
    const count = Array.isArray(group.options) ? group.options.length : 0;
    if (count > SCOPE_ASK_MAX_OPTIONS) {
      return `Refused: scope question ${index + 1} carries ${count} options over the ${SCOPE_ASK_MAX_OPTIONS} maximum — `
        + "split into batched groups in one call, all preselected, never drop scopes to fit.";
    }
  }
  const checked = list.flatMap((group) => Array.isArray(group?.options) ? group.options : [])
    .some((option) => option?.selected === true);
  if (!checked) {
    return "Refused: no scope option starts checked — scope confirms are opt-out, "
      + "mark every keep option --selected so keeping means doing nothing.";
  }
  return null;
}

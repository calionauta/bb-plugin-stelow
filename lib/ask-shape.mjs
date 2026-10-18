/**
 * The ask shape rules that belong to every question, not just a tagged one.
 *
 * `scopeAskRefusal` (lib/question-gate) is authority-scoped: it reads a tag and
 * a review mode so a scope confirm can be refused in Auto. These rules are
 * shape-scoped and authority-free — a radio with too many rows is malformed
 * whoever asked, and a one-choice question that recommends most of its own rows
 * cannot be answered as a choice (issue #384).
 *
 * Pure and host-free, so the matrix is pinned in `tests/ask-shape.test.mjs`
 * without standing up a card.
 */

/**
 * A radio group may not carry more rows than this. Same six as Pattern 3, on
 * purpose: one convention, not two.
 *
 * The ceiling applies to SINGLE-select questions at every stage, and that
 * asymmetry is measured, not assumed. Across the asks this host has recorded,
 * multi-select confirms legitimately reach seven rows ("keep these seven things
 * IN?") — a number the reader scans and mostly leaves checked. A radio with
 * seven mutually exclusive rows is a different object: it asks the reader to
 * weigh seven options and pick one, which is what a question is for, not what a
 * menu is for. The ask that prompted this carried eight critique findings
 * compressed into one 7-row radio, five of them marked "(Recommended)" — no
 * reader can hold seven mutually exclusive choices well enough to answer.
 * Single-select legitimately reached five, so six refuses only the shape that
 * was actually wrong (issue #384).
 */
export const SINGLE_SELECT_MAX_OPTIONS = 6;

/**
 * True when a label carries the recommendation marker as its own token.
 *
 * The parentheses are escaped ONCE. `\\(` (two backslashes) does not match a
 * parenthesis in a regex literal — it matches a LITERAL BACKSLASH followed by
 * `(Recommended\` — so the first version of this matched no label the project
 * ever writes (upstream emits "Shaping (Recommended)") and the whole rule below
 * was unreachable while looking correct. `tests/ask-shape.test.mjs` caught it by
 * asserting the spec instead of the code.
 */
function carriesRecommendation(label) {
  return /\(Recommended\)/i.test(String(label ?? ""));
}

/** A group's options array, tolerating a malformed group. */
function groupOptions(group) {
  return Array.isArray(group?.options) ? group.options : [];
}

/** The label of an option that may be a bare string or an object. */
function optionLabel(option) {
  return option === null || typeof option !== "object" ? option : option.label;
}

/**
 * The shape rules that belong to EVERY ask, not just a tagged scope confirm.
 *
 * `scopeAskRefusal` below is authority-scoped: it reads a tag and a review mode
 * so a scope confirm can be refused in Auto. These two rules are shape-scoped
 * and authority-free — a radio with too many rows is malformed whoever asked,
 * and a single-select question that recommends most of its own rows cannot be
 * answered as a choice.
 *
 * Returns the refusal sentence, or null. Pure, so the matrix is pinned in
 * `tests/ask-shape.test.mjs` without standing up a card.
 */
export function askShapeRefusal({ groups }) {
  const list = Array.isArray(groups) ? groups : [];
  for (const [index, group] of list.entries()) {
    if (!group || typeof group !== "object") continue;
    const options = groupOptions(group);
    const count = options.length;
    const where = `question ${index + 1}`;
    // A radio that offers more rows than the shared ceiling is almost always
    // independent decisions wearing the wrong widget, so the refusal names that
    // exit first — the worker's actual error, not merely its size.
    if (group.multiple !== true && count > SINGLE_SELECT_MAX_OPTIONS) {
      return `Refused: ${where} offers ${count} choices as a single-select over the `
        + `${SINGLE_SELECT_MAX_OPTIONS} maximum — a reader cannot weigh that many mutually exclusive `
        + "options in one pick. If the rows are independent decisions, mark the ones to keep with "
        + "--multiple; if it is really one choice, split it into separate questions in one call.";
    }
    // One answer, so more than one recommendation is self-contradictory: the
    // marker stops discriminating and the reader is left ranking the options
    // themselves. "Recommend, don't dump" (ask-patterns) is the rule; this is
    // its enforceable half.
    if (group.multiple !== true) {
      const recommended = options.filter((option) => carriesRecommendation(optionLabel(option)));
      if (recommended.length > 1) {
        return `Refused: ${where} is single-select but marks ${recommended.length} options `
          + '"(Recommended)" — a one-choice question can recommend only one, or the marker tells the '
          + "reader nothing and they rank the options themselves. Keep the one that fits and say why "
          + "the others do not (ask-patterns: \"Recommend, don't dump\").";
      }
    }
  }
  return null;
}


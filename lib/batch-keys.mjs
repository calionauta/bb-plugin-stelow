/**
 * Keyboard accelerator for a batch of structured questions.
 *
 * The question card is answerable by mouse today; this module is the whole
 * decision layer for answering it from the keys. It is pure on purpose: the
 * component binds `keydown` on the questions container, hands the event and a
 * plain context here, and acts on the returned decision. Nothing in this file
 * touches the DOM, React, or global state, so every rule below is checked by a
 * plain `node` test instead of a rendered mount.
 *
 * Two rules carry most of the weight:
 *
 *  - Inertness inside a text field. While the reader is typing in the note,
 *    digits and letters must reach the field: `3` may not jump to question 3
 *    and `j` / `k` must be typeable. Every accelerator goes quiet there except
 *    the save chord, which is how a reader submits from inside the note.
 *  - Never swallow a key we do not use. The card can render as a tab beside a
 *    live terminal, so an unrecognised or inapplicable key returns null and the
 *    caller lets it through unchanged.
 */

/** Elements whose keystrokes belong to a text field, not to the accelerator. */
const TEXT_ENTRY_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

/**
 * The terse, always-visible hint line. Ordered as a sentence a newcomer can
 * follow: pick, move, note, skip, document, help, submit. The complete list
 * lives behind `?`; this array is the subset that stays on screen, so every
 * entry must stay short enough to read at a glance.
 */
/**
 * The terse, always-visible hint line.
 *
 * Kept SHORT on purpose. It is permanent chrome above the submit, so every extra
 * entry costs the reader attention on a surface whose whole job is one decision.
 * It carries the keys a newcomer needs to get unstuck — pick, move, submit, and
 * where the rest live — and nothing more.
 */
export const BATCH_KEY_LEGEND = [
  { keys: "1-9", label: "pick" },
  { keys: "← →", label: "next question" },
  { keys: "⌘/Ctrl+↵", label: "submit" },
  { keys: "?", label: "all shortcuts" },
];

/**
 * Every shortcut, in the order a reader meets them.
 *
 * This is what `?` opens. It is a SEPARATE, longer list than the legend on
 * purpose: `?` that repeats the line already on screen is a control that does
 * nothing, and the alternative words — `j`/`k` for movement, `o` for the note,
 * `s` to skip, `x` for the document — are exactly the ones that need somewhere
 * to be written down.
 */
export const BATCH_KEY_LIST = [
  { keys: "1-9", label: "pick option 1 to 9" },
  { keys: "← →", label: "previous / next question" },
  { keys: "j k", label: "same, home-row only" },
  { keys: "o", label: "write a note" },
  { keys: "s", label: "skip this question" },
  { keys: "x", label: "open the option's document" },
  { keys: "⌘/Ctrl+↵", label: "submit every answer" },
  { keys: "?", label: "hide this list" },
];

/**
 * A reader with the cursor in a note owns the keyboard. Recognised
 * case-insensitively because `tagName` has no guaranteed casing across
 * element-shaped objects, and absence of the property is not evidence of a
 * text field (`isContentEditable` may be the only signal).
 */
function isTextEntry(target) {
  if (!target || typeof target !== "object") return false;
  if (target.isContentEditable === true) return true;
  const tagName = typeof target.tagName === "string" ? target.tagName.trim().toUpperCase() : "";
  return TEXT_ENTRY_TAGS.has(tagName);
}

/** Integers only, floored at zero; a garbage field degrades to the safe default. */
function safeCount(value, fallback) {
  return Number.isInteger(value) && value >= 0 ? value : fallback;
}

function readContext(context) {
  const source = context && typeof context === "object" ? context : {};
  const questionCount = safeCount(source.questionCount, 1);
  return {
    questionIndex: safeCount(source.questionIndex, 0),
    // A batch always has at least one question; a missing count must refuse
    // moves rather than invent a range to move inside.
    questionCount: questionCount < 1 ? 1 : questionCount,
    optionCount: safeCount(source.optionCount, 0),
    canSkip: source.canSkip === true,
    hasDocument: source.hasDocument === true,
  };
}

/** Out-of-range moves are refused, never wrapped: wrapping hides the edge. */
function moveTo(toIndex, questionCount) {
  return toIndex >= 0 && toIndex < questionCount ? { type: "move", toIndex } : null;
}

/**
 * Decide what a single keydown means for the batch, or `null` when the key is
 * not ours. Case-insensitive for `o` / `s` / `x` / `j` / `k`: a reader holding
 * Shift must not meet a different app, and Shift+/ is how `?` arrives anyway.
 *
 * Deliberately unmentioned by the key map and chosen here: `Ctrl` / `Cmd` /
 * `Alt` disqualify every accelerator except the submit chord. Those are the
 * browser's and the terminal's modifiers (Ctrl+S saves the page, Cmd+O opens a
 * file), and the card shares its screen with a live terminal — so a modified
 * letter or digit falls through instead of being claimed.
 */
export function batchKeyDecision(event, context) {
  const key = typeof event?.key === "string" ? event.key : "";
  if (!key) return null;

  const meta = event.metaKey === true || event.ctrlKey === true;
  // The save chord, and the only accelerator alive inside a note. A bare
  // Enter is the reader's newline, and Shift+Enter is the same newline: Shift
  // disqualifies the chord so exactly one combination means submit.
  if (key === "Enter") return meta && event.shiftKey !== true ? { type: "submit" } : null;

  // Everything below is a plain key chord. In a text field the reader is
  // typing, so nothing here is ours.
  if (isTextEntry(event?.target)) return null;
  if (event.metaKey === true || event.ctrlKey === true || event.altKey === true) return null;

  const ctx = readContext(context);

  if (/^[1-9]$/.test(key)) {
    const optionIndex = key.charCodeAt(0) - 49;
    // A digit past the last option is not a near miss: fall through (a
    // one-option question must not answer itself on "7").
    return optionIndex < ctx.optionCount ? { type: "pick", optionIndex } : null;
  }

  const letter = key.toLowerCase();
  if (key === "ArrowRight" || letter === "j") return moveTo(ctx.questionIndex + 1, ctx.questionCount);
  if (key === "ArrowLeft" || letter === "k") return moveTo(ctx.questionIndex - 1, ctx.questionCount);

  if (letter === "o") return { type: "focus-note" };
  if (letter === "s") return ctx.canSkip ? { type: "toggle-skip" } : null;
  if (letter === "x") return ctx.hasDocument ? { type: "open-document" } : null;
  if (key === "?") return { type: "show-keys" };

  return null;
}

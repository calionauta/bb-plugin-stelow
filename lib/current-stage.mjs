/**
 * The one reader for a workflow's current stage.
 *
 * Seven places in the host used to derive this fact with their own regex, and
 * four of them were unanchored: `current_stage:\s*(\S+)` without `^`. On a state
 * file where any line merely MENTIONS the field — a note, a quoted example, a
 * commented-out old value — an unanchored match returns the mention instead of
 * the stage, and the panel, the done gate and the thread projection then disagree
 * about where the card is while each one believes it read the file.
 *
 * One reader, one anchor, one answer. Callers keep their own normalisation of
 * `null` (some want `""`, some want `null`), because that is a presentation
 * choice; the parse is not.
 */
export const CURRENT_STAGE_PATTERN = /^current_stage:\s*(\S+)\s*(?:#.*)?$/m;

/**
 * The stage named by the state file's frontmatter, or null.
 *
 * A quoted value is unquoted: state files are hand-edited often enough that both
 * spellings exist, and the quote is punctuation, not part of the stage name. A
 * trailing `# comment` on the line is tolerated, because the anchor is about not
 * matching a MENTION on another line, not about being strict with a reader who
 * annotated the value.
 */
export function parseCurrentStage(text) {
  if (typeof text !== "string") return null;
  const match = text.match(CURRENT_STAGE_PATTERN);
  if (!match) return null;
  const value = match[1].replace(/^["']/, "").replace(/["']$/, "").trim();
  return value === "" ? null : value;
}

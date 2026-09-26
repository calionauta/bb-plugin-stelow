/**
 * Where an option lives inside the document it points at.
 *
 * Context: an Interface Contrast ask offers A, B, C and a hybrid, and every
 * option opens the SAME brief — one file holding all four proposals. Opening
 * it lands at the top of the document, so the option the reader just clicked
 * is the one thing they do not see: the hybrid sits at the bottom, below
 * three proposals they did not pick. On a real card that is exactly what
 * happened — a reader opened the brief from "Hybrid A+C" and found A and B.
 *
 * The label names the option, so the anchor can find the section that carries
 * the same name. When a brief has no matching section — a combined file that
 * never used per-option headings, or an option with no section at all — this
 * returns null and the reader lands at the top, which is honest: there is
 * nothing better to show them.
 */

/**
 * Split a label or heading into comparable words.
 *
 * Matching is on WORDS, not on characters. Substring containment is the
 * obvious rule and it is wrong: the label "Hybrid A+C" is contained in the
 * document title "Scope Map interface proposals (v1, Core: 3 + hybrid)"
 * because both end in "hybrid", so the anchor lands on the file's H1 and the
 * reader is back where they started. A word set cannot be swallowed like that
 * — the title carries neither the "a" nor the "c" that name the option.
 *
 * Single letters count. They are how a combined brief names its options
 * ("Proposal A", "(A + C)"), and dropping them would leave nothing to match.
 *
 * Exported because the viewer compares the SAME key against the headings the
 * host already rendered, in order to scroll to one. The comparison must not
 * restate the matching rule: a second, looser copy in the UI is how the
 * scroll starts disagreeing with the anchor.
 */
export function headingWords(value) {
  return String(value ?? "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 0);
}

/** True when one word set fully names the other. */
function wordsCover(shorter, longer) {
  if (shorter.length === 0 || shorter.length > longer.length) return false;
  const pool = [...longer];
  for (const word of shorter) {
    const at = pool.indexOf(word);
    if (at === -1) return false;
    pool.splice(at, 1);
  }
  return true;
}

/** A single-character word is how a combined brief names an option. */
function isOptionLetter(word) {
  return word.length === 1;
}

/** The letters an option is called by. */
function optionLetters(words) {
  return words.filter(isOptionLetter);
}

/**
 * Does a heading name this option, and how well?
 *
 * Three routes, in descending strength, because a brief and a card label are
 * written by different steps and neither is the contract:
 *
 *  1. The heading carries every word of the label — "Hybrid recommendation
 *     (A + C)" for "Hybrid A+C". The label is fully present.
 *  2. The label carries every word of the heading — "A stacked blocks" for a
 *     brief that only wrote "## Proposal". The heading is fully present, so
 *     the heading is a summary of the label rather than a different option.
 *  3. Both name the same option LETTER — "## Proposal A" for "A stacked
 *     blocks". Words overlap not at all; only the letter does. Still a real
 *     answer, and far better than none, but the weakest, so any full match
 *     elsewhere in the brief wins.
 *
 * @returns {{ full: boolean; extra: number } | null} null when the heading
 *   names nothing of this option; otherwise whether a full match exists and
 *   how many words the pair adds beyond each other.
 */
function headingNamesOption(heading, label) {
  const labelHasAll = wordsCover(label, heading);
  const headingHasAll = wordsCover(heading, label);
  if (labelHasAll || headingHasAll) {
    return { full: true, extra: Math.abs(heading.length - label.length) };
  }
  const sharesLetter = optionLetters(label).some((letter) => optionLetters(heading).includes(letter));
  if (sharesLetter && namesNothingBut(heading, optionLetters(heading))) {
    return { full: false, extra: Math.max(heading.length, label.length) };
  }
  return null;
}

/**
 * The one scan: which heading in a document is about this option?
 *
 * Shared by the anchor and the excerpt so they can never point at different
 * sections — two functions each picking "the best match" is how a control ends
 * up saying one thing and opening another.
 *
 * @returns {{ index: number; line: string; score: object } | null}
 */
function findOptionHeading(lines, labelWords) {
  // A heading is the match: `## Proposal A — ...` or `## Hybrid recommendation`.
  let best = null;
  for (const [index, line] of lines.entries()) {
    if (!/^#{1,6}\s+/.test(line)) continue;
    const whole = headingWords(line.replace(/^#{1,6}\s+/, ""));
    const score = headingNamesOption(whole, labelWords);
    if (score === null) continue;
    // Several headings can name the option ("## Hybrid", then "## Hybrid
    // A+C"). Take the one that names it most precisely, so the match is the
    // section about THIS option rather than the broadest heading that happens
    // to contain its name. Ties keep the earlier section: a brief discusses
    // its recommendation before the alternatives it rejects.
    const better = best === null
      || (score.full && !best.score.full)
      || (score.full === best.score.full && score.extra < best.score.extra);
    if (better) best = { index, line, score };
  }
  return best;
}

function documentLines(content) {
  const text = typeof content === "string" ? content : "";
  return text.length === 0 ? null : text.split("\n");
}

/**
 * Words a heading may carry besides the option's letter, and still be naming
 * the option rather than describing a different one.
 *
 * The letter route exists for a brief that names its options by letter alone —
 * "## Proposal A", "## Section C". It must NOT fire on a heading that
 * *describes* an option, because then it matches the wrong option: the label
 * "Hybrid A+C" shares the letter "a" with "## Option A — Extend the existing
 * Scope stage", and that heading is plainly about something else. On a real
 * card that sent the reader to Option A when they clicked the hybrid, and the
 * document it scrolled to had no hybrid in it at all.
 *
 * So the letter route fires only when the heading is a bare option marker:
 * the letter, plus at most generic marker words and nothing that could belong
 * to a described option.
 */
const OPTION_MARKER_WORDS = new Set([
  "proposal", "option", "section", "idea", "direction", "variant",
  "alternative", "choice", "candidate", "pick", "variant",
]);

/**
 * @param {string[]} heading the heading's words
 * @param {string[]} letters the option letters it carries
 */
function namesNothingBut(heading, letters) {
  return heading.every((word) => letters.includes(word) || OPTION_MARKER_WORDS.has(word));
}

/**
 * Does a heading the host RENDERED name the section we resolved?
 *
 * The viewer has the option's heading from `optionSectionExcerpt` and the
 * headings the renderer produced; matching those two is the same question the
 * text scan already answers, so it lives here rather than in the component.
 * A component-local copy of the rule is exactly how a scroll starts disagreeing
 * with the anchor it was supposed to follow — and it cannot be tested, because
 * it needs a DOM.
 *
 * Containment in either direction, because the two spellings differ: the brief
 * writes "Hybrid recommendation (A + C)" and the card says "Hybrid A+C".
 *
 * @param {unknown} rendered the rendered heading's text
 * @param {unknown} target the heading the text scan resolved
 */
export function sectionHeadingsMatch(rendered, target) {
  const left = headingWords(rendered);
  const right = headingWords(target);
  if (left.length === 0 || right.length === 0) return false;
  const covers = (shorter, longer) => shorter.every((word) => longer.includes(word));
  return covers(right, left) || covers(left, right);
}

/**
 * @param {unknown} content the document text
 * @param {string} label the option label as the reader sees it
 * @returns {{ anchor: string; line: number } | null}
 */
export function optionSectionAnchor(content, label) {
  const lines = documentLines(content);
  const labelWords = headingWords(label);
  if (lines === null || labelWords.length === 0) return null;
  const best = findOptionHeading(lines, labelWords);
  if (best === null) return null;
  return { anchor: anchorIdFor(best.line, best.index), line: best.index + 1 };
}

/**
 * The option's own section, as text, lifted out of the document.
 *
 * Why a lifted section rather than a scroll: the viewer renders the document
 * as markdown, and its headings carry no ids to scroll to. Injecting them
 * would mean rewriting the renderer's output. Lifting the section answers the
 * question the reader actually has — "what does THIS option say?" — before
 * they have to hunt for it, and the full document still sits below.
 *
 * The excerpt runs to the next heading of the same or higher rank, so a
 * section never swallows the one after it.
 *
 * @returns {{ heading: string; body: string; line: number } | null}
 */
export function optionSectionExcerpt(content, label) {
  const lines = documentLines(content);
  const labelWords = headingWords(label);
  if (lines === null || labelWords.length === 0) return null;
  const best = findOptionHeading(lines, labelWords);
  if (best === null) return null;

  const rank = (line) => (line.match(/^#{1,6}\s+/) ?? [""])[0].trim().length;
  const startRank = rank(best.line);
  const body = [];
  for (const line of lines.slice(best.index + 1)) {
    if (/^#{1,6}\s+/.test(line) && rank(line) <= startRank) break;
    body.push(line);
  }
  return {
    heading: best.line.replace(/^#{1,6}\s+/, "").trim(),
    body: body.join("\n").trim(),
    line: best.index + 1,
  };
}

/** A stable, DOM-safe id so the viewer can scroll and focus the heading. */
export function anchorIdFor(headingLine, index) {
  const slug = headingWords(String(headingLine ?? "").replace(/^#{1,6}\s+/, "")).join("-").slice(0, 48);
  return slug.length > 0 ? `option-section-${slug}-${index}` : `option-section-${index}`;
}

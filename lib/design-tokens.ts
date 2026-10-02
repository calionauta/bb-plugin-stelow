/**
 * The card's type scale, named.
 *
 * The UI had a scale and nobody had written it down. `text-[11px]` appeared 102
 * times, `text-[10px]` 6, and then 9, 13, 15 and 16px once each — so six sizes
 * outside Tailwind's own scale, all of them real, and the most-used one
 * (11px) invented by whoever needed a small section heading first. That is what
 * "we have a design system" looks like before anyone names it: a scale that
 * emerged from use and is therefore invisible to review, because a reviewer
 * cannot check a rule that was never stated.
 *
 * Naming it changes what can be checked. A new size is now a diff against these
 * four names rather than another arbitrary number, and
 * `tests/card-design-tokens.test.mjs` fails on one.
 *
 * The scale is deliberately four steps, not seven, because the card is a column
 * of sections rather than an article: a reader scans a card for ONE state line
 * and a few facts, and every step below that is metadata. A seventh size would
 * be a distinction no reader has ever asked to make.
 */

/** The card's one authoritative state line. Exactly one per screen. */
export const TEXT_STATE = "text-[16px] font-semibold leading-snug tracking-tight text-foreground";

/**
 * A section's own heading: the label on a collapsed row.
 *
 * Was `text-[11px]`, which is the whole reason this token needed a second look:
 * the card's complaint was that section labels were the smallest text on the
 * page, and importing this token changed the identifier without changing a
 * single rendered pixel. 11px was also *below* `TEXT_META` (`text-xs`, 12px) —
 * a section label smaller than the metadata under it, which is the scale
 * reading itself backwards.
 *
 * 12px is the step the scale could actually take: `text-xs` is already
 * `TEXT_META`, and two steps sharing a size is the same step under two names,
 * which `card-design-tokens` fails. 12px sits above the old 11px, below
 * `text-sm`, and remains distinct from every other step.
 */
export const TEXT_SECTION = "text-[12px] font-semibold uppercase tracking-wider text-muted-foreground";

/** Running text the reader is expected to read rather than scan. */
export const TEXT_BODY = "text-sm leading-relaxed text-foreground";

/**
 * A tab label — the panel's primary navigation.
 *
 * This step exists because the tab bar was built at 13px, between the meta and
 * body steps, and nobody wrote down why. It is a real fifth role rather than a
 * mistake: a tab is a target, not a label, and it has to read as pressable
 * without becoming a heading. Naming it is what makes the number defensible;
 * leaving it anonymous is how a scale stops being one.
 */
export const TEXT_TAB = "text-[13px] font-medium";

/**
 * Metadata, and the step that was doing the most damage unexamined.
 *
 * Almost every fact on the card is meta: a count in a hint, a timestamp, a
 * status word, a list of names. It is also the step most likely to be nudged
 * from 11px to 10px "to fit", which is how a scale quietly stops being one.
 */
export const TEXT_META = "text-xs text-muted-foreground";

/** Every size the card is allowed to render at. A test reads this list. */
export const TYPE_SCALE = [TEXT_STATE, TEXT_TAB, TEXT_SECTION, TEXT_BODY, TEXT_META] as const;

/**
 * Sizes that are NOT in the scale, with what each one is for.
 *
 * A scale is only real if the exceptions are listed. These three are deliberate
 * and each earns its place: 10px is a model identifier where the string itself
 * is the content, 15px is the card's request text — the one thing on the card
 * large enough to read comfortably as prose — and 9px is a superscript-grade
 * annotation. Anything not on this list is a new decision, not a default.
 */
export const TYPE_EXCEPTIONS: Record<string, string> = {
  "text-[10px]": "a literal model id, where the string IS the content",
  "text-[15px]": "the card's own request text — the one passage read as prose",
  "text-[9px]": "superscript-grade annotation, nothing else",
  // 11px is no longer a STEP — `TEXT_SECTION` moved to 12px, because a section
  // label smaller than the metadata under it read the scale backwards and was
  // the smallest text on the page. The size itself stays as a recorded
  // exception for the ~100 sites that already use it: it is the same size doing
  // the same job, and rewriting them here would bury one type decision under a
  // hundred mechanical diffs. Those sites are counted, not invisible, and each
  // becomes a one-token change whenever its file is next touched.
  "text-[11px]": "legacy metadata and label text, awaiting migration onto a named step; "
    + "no NEW site may use it and no section label uses it",
};

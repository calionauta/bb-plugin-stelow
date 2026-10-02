/**
 * Contract-aware excerpting for the independent reviewer.
 *
 * The reviewer used to receive the first `MAX_REVIEW_CHARS` of the artifact and
 * a note that truncation happened. For a long document that is the wrong 12k:
 * a substantial introduction pushes the very section the contract names past
 * the cut, so the reviewer judges a document whose required table is missing —
 * and the prompt's own truncation note makes that look considered rather than
 * accidental. "The reviewer read what was sent" was true and useless.
 *
 * So the excerpt is chosen by the CONTRACT, not by offset: the request, then the
 * headings the contract requires (and any per-option headings a comparison is
 * built from), each with its body, until the budget runs out. A document that
 * fits is sent whole. When the contract is unknown or names nothing the excerpt
 * falls back to today's head slice — still recorded, so a reader can always tell
 * which of the two happened.
 *
 * Pure and dependency-free: no I/O, no model, and the caller passes the contract
 * it already resolved. Everything it decides is reported back in `excerpt`, so
 * the review row can say what the reviewer actually saw instead of assuming.
 */

/** Chars of artifact sent to the reviewer. A cost ceiling, not a judgment. */
export const MAX_REVIEW_CHARS = 12000;

/** Heading levels the contract's `named-headings` check can require. */
function headingPattern() {
  return /^(#{1,6})\s+(.*?)\s*$/;
}

/** Every heading in the document, with the char range of its section body. */
export function documentSections(text) {
  const lines = String(text ?? "").split("\n");
  const headings = [];
  let offset = 0;
  for (const line of lines) {
    const match = line.match(headingPattern());
    if (match) {
      headings.push({
        level: match[1].length,
        text: match[2].replace(/:$/, "").trim(),
        start: offset,
        bodyStart: offset + line.length + 1,
        end: text.length,
      });
    }
    offset += line.length + 1;
  }
  // Each section runs to the next heading of the same or a shallower level —
  // a subsection belongs to the section that contains it.
  for (let i = 0; i < headings.length; i++) {
    const next = headings.slice(i + 1).find((heading) => heading.level <= headings[i].level);
    headings[i].end = next ? next.start : text.length;
  }
  return headings;
}

/**
 * The heading names a contract requires, in document order of appearance.
 *
 * The contract's checks are the same DSL `lib/artifact-validation.mjs`
 * interprets, so this reads them rather than re-declaring them: a `contains`
 * needle that happens to be a heading, a `named-headings` name, and the
 * `startsWithAny` stems a comparison uses for its options.
 */
export function contractHeadings(contract) {
  const names = [];
  const stems = [];
  for (const check of Array.isArray(contract?.checks) ? contract.checks : []) {
    if (check?.kind === "named-headings" && Array.isArray(check.names)) {
      names.push(...check.names.filter((name) => typeof name === "string" && name.trim()));
    }
    if (check?.kind === "headings" && Array.isArray(check.startsWithAny)) {
      stems.push(...check.startsWithAny.filter((stem) => typeof stem === "string" && stem.trim()));
    }
  }
  return { names, stems };
}

function matchesContractHeading(heading, { names, stems }) {
  const text = heading.text.toLowerCase();
  if (names.some((name) => text.includes(String(name).toLowerCase()))) return true;
  return stems.some((stem) => text.startsWith(String(stem).toLowerCase()));
}

/**
 * Pick the excerpt the reviewer receives.
 *
 * Returns `{ text, truncated, originalChars, sentChars, selected }` where
 * `selected` names how the excerpt was chosen — `whole`, `contract`, or `head`
 * — because a reviewer that judged a head slice and a reviewer that judged the
 * contract's sections are different reviewers, and the difference has to be
 * readable after the fact.
 */
export function selectReviewExcerpt(content, contract, { maxChars = MAX_REVIEW_CHARS } = {}) {
  const body = typeof content === "string" ? content : "";
  if (body.length <= maxChars) {
    return { text: body, truncated: false, originalChars: body.length, sentChars: body.length, selected: "whole" };
  }

  const wanted = contractHeadings(contract);
  const sections = documentSections(body)
    .filter((heading) => matchesContractHeading(heading, wanted))
    .map((heading) => ({ text: body.slice(heading.start, heading.end), heading: heading.text }));
  if (sections.length === 0) {
    return {
      text: body.slice(0, maxChars),
      truncated: true,
      originalChars: body.length,
      sentChars: maxChars,
      selected: "head",
    };
  }
  const text = joinSectionsWithinBudget(sections, maxChars);
  return {
    text,
    truncated: true,
    originalChars: body.length,
    sentChars: text.length,
    selected: "contract",
    headings: sections.map((section) => section.heading),
  };
}

/**
 * The matched sections, in document order, until the budget runs out.
 *
 * The marker a mid-section cut appends is budgeted BEFORE the slice is taken,
 * not after: a cap the note itself can push over is not a cap, and the overflow
 * was small enough to look like rounding and large enough to make the promise
 * false. A section that does not fit ends the excerpt rather than being skipped
 * — the reviewer reads a prefix of the document, never a stitched-together
 * selection that hides what was left out.
 */
function joinSectionsWithinBudget(sections, maxChars) {
  const parts = [];
  let used = 0;
  for (const section of sections) {
    const room = maxChars - used;
    if (room <= 0) break;
    if (section.text.length <= room) {
      parts.push(section.text);
      used += section.text.length;
      continue;
    }
    const marker = `\n\n[section truncated at ${maxChars} chars]`;
    if (room > marker.length) {
      parts.push(`${section.text.slice(0, room - marker.length)}${marker}`);
    }
    break;
  }
  return parts.join("\n\n");
}

import assert from "node:assert/strict";
import { optionSectionAnchor, optionSectionExcerpt, anchorIdFor } from "../lib/option-anchor.mjs";

// The real brief from the card that started this: four options, one combined
// document, and the hybrid sitting at the bottom below three proposals the
// reader did not pick. Opening from the option row landed at the top, so the
// one section they wanted was the one thing not on screen.
const brief = [
  "# Scope Map interface proposals (v1, Core: 3 + hybrid)",
  "",
  "## Proposal A — Stacked per-scope blocks (dependency order)",
  "Stacked per-scope blocks in dependency order.",
  "",
  "## Proposal B — Compact table (one row per scope)",
  "Dense table layout.",
  "",
  "## Proposal C — Attention lanes (needs-decision first)",
  "Needs-decision lanes first.",
  "",
  "## Hybrid recommendation (A + C)",
  "Stacked per-scope blocks (A) ordered by attention (C): scopes with open",
  "decisions or blockers first, then in-progress, then done collapsed to one",
  'line each — with a one-line note preserving dependency order ("after S0")',
  "inside each block so no information is lost. Table density (B) is sacrificed:",
  "readability of verbatim boundaries and routable decisions matters more than",
  "fitting everything above the fold, and collapse + banner already bound height.",
  "",
  "## Out (all proposals)",
  "Mutations, dependency inference, decision input UI.",
].join("\n");

// The case that shipped: clicking "Hybrid A+C" and finding A and B.
const hybrid = optionSectionAnchor(brief, "Hybrid A+C");
assert.ok(hybrid, "the hybrid section is found in the brief");
assert.match(brief.split("\n")[hybrid.line - 1], /Hybrid recommendation/, "the anchor lands on the hybrid, not the top of the file");
const headingAt = (line) => brief.split("\n")[line - 1];
assert.ok(
  hybrid.line > optionSectionAnchor(brief, "C attention lanes").line,
  "the hybrid is the LAST of the four, so opening at the top shows only what the reader did not pick",
);

// Every option resolves to its OWN section — the whole point.
assert.match(brief.split("\n")[optionSectionAnchor(brief, "A stacked blocks").line - 1], /Proposal A/, "A resolves to its own section");
assert.match(brief.split("\n")[optionSectionAnchor(brief, "B compact table").line - 1], /Proposal B/, "B resolves to its own section");
assert.match(brief.split("\n")[optionSectionAnchor(brief, "C attention lanes").line - 1], /Proposal C/, "C resolves to its own section");

// Punctuation, case and spacing must not decide the match: the label on the
// card and the heading in the document are written by different steps.
assert.equal(optionSectionAnchor(brief, "hybrid a+c")?.line, hybrid?.line, "case and spacing are normalized");
assert.equal(optionSectionAnchor(brief, "B — compact table")?.line, optionSectionAnchor(brief, "B compact table")?.line, "punctuation is normalized");
assert.equal(
  optionSectionAnchor(brief, "C attention lanes (needs-decision first)")?.line,
  optionSectionAnchor(brief, "C attention lanes")?.line,
  "a parenthesized gloss does not break the match",
);

// An anchor id must be stable and DOM-safe, or the viewer cannot scroll to it.
assert.match(hybrid.anchor, /^option-section-[a-z0-9-]+$/, "the anchor id is a safe DOM id");
assert.equal(hybrid.anchor, optionSectionAnchor(brief, "Hybrid A+C").anchor, "the same option yields the same anchor, so it is scrollable");
assert.notEqual(
  optionSectionAnchor(brief, "A stacked blocks").anchor,
  hybrid.anchor,
  "different options get different anchors",
);

// The document TITLE mentions every option ("3 + hybrid") and must still lose.
// Substring matching anchors there — both strings end in "hybrid" — which is
// the same useless top-of-file opening the anchor exists to prevent.
assert.equal(
  optionSectionAnchor(brief, "Hybrid A+C").line,
  brief.split("\n").findIndex((line) => /Hybrid recommendation/.test(line)) + 1,
  "the title mentioning the hybrid does not win the match",
);
assert.notEqual(optionSectionAnchor(brief, "Hybrid A+C").line, 1, "the anchor is never the file title");

// A broad heading and a specific one can both name the option; the specific
// one wins, so the anchor is the section about THIS option.
const withBroadAndSpecific = [
  "## Hybrid",
  "the framing paragraph",
  "## Hybrid A+C",
  "the recommendation",
].join("\n");
assert.equal(optionSectionAnchor(withBroadAndSpecific, "Hybrid A+C").line, 3, "the tightest matching heading wins");
assert.equal(optionSectionAnchor(withBroadAndSpecific, "Hybrid").line, 1, "a label naming only the broad heading still finds it");
// Both readings must agree even where the choice is arguable. Two functions
// each picking "a plausible match" is how a control ends up saying one thing
// and opening another — this fixture is the case where they would differ.
assert.equal(
  optionSectionExcerpt(withBroadAndSpecific, "Hybrid A+C").line,
  optionSectionAnchor(withBroadAndSpecific, "Hybrid A+C").line,
  "the excerpt opens the same section the anchor names",
);
assert.equal(
  optionSectionExcerpt(withBroadAndSpecific, "Hybrid A+C").body,
  "the recommendation",
  "and it is this option's text, not the broad heading's",
);

// The other direction: the label is the fuller name. A brief that names its
// options by letter alone ("## Proposal A") still has to answer a reader who
// clicked "A stacked blocks" — matching only when the heading contains the
// whole label would report no section and send them back to the top.
const letterOnly = [
  "## Proposal A",
  "blocks",
  "## Proposal B",
  "table",
].join("\n");
assert.equal(optionSectionAnchor(letterOnly, "A stacked blocks").line, 1, "a letter-only heading still anchors its option");
assert.equal(optionSectionAnchor(letterOnly, "B compact table").line, 3, "and does so for the next one, not the first");
assert.equal(optionSectionAnchor(letterOnly, "C attention lanes"), null, "an option with no section does not borrow one");

// A letter route must accept ANY shared letter, not just the first, and it
// must be reachable when NO word is shared — the only thing these two headings
// and "Hybrid A+C" have in common is a letter. Reading only the label's first
// letter would find nothing here and send the reader back to the top.
const oneLetter = ["## Section C", "c"].join("\n");
assert.equal(optionSectionAnchor(oneLetter, "Hybrid A+C").line, 1, "any shared letter routes, not only the first");

// A brief with no matching section must return null, not a wrong answer. The
// viewer then opens at the top, which is honest: there is nothing better.
assert.equal(optionSectionAnchor(brief, "D something else"), null, "an option with no section does not borrow one");
assert.equal(optionSectionAnchor("# Only a title\n\nno sections here", "Hybrid"), null, "a heading-free document has no anchor");
assert.equal(optionSectionAnchor("## Out (all proposals)", "Hybrid A+C"), null, "a heading that does not name the option is not a match");

for (const [label, value] of [["null content", null], ["a number", 7], ["an object", {}], ["empty label", ""], ["null label", null]]) {
  assert.equal(optionSectionAnchor(value, "Hybrid"), null, `${label} yields no anchor rather than throwing`);
  assert.equal(optionSectionExcerpt(value, "Hybrid"), null, `${label} yields no excerpt rather than throwing`);
}

// The excerpt is what the reader actually gets: the option's own words, not
// a scroll position they have to find. The hybrid's section says the trade-off
// the top of the document never mentions.
const hybridExcerpt = optionSectionExcerpt(brief, "Hybrid A+C");
assert.equal(hybridExcerpt.heading, "Hybrid recommendation (A + C)", "the excerpt is titled by the section it found");
assert.match(hybridExcerpt.body, /Table density \(B\) is sacrificed/, "the excerpt carries the section's own claim");
assert.match(hybridExcerpt.body, /dependency order/, "and its reasoning");
assert.doesNotMatch(hybridExcerpt.body, /Proposal A|Proposal B|Proposal C/, "and none of the options they did not pick");
assert.equal(hybridExcerpt.line, optionSectionAnchor(brief, "Hybrid A+C").line, "the excerpt and the anchor name one section, never two");

// A section must stop at the next heading of the same or higher rank. Reading
// past it is the same bug as opening at the top: the reader is shown the
// wrong option's text.
const nested = [
  "## Proposal A",
  "a intro",
  "### A detail",
  "a detail body",
  "## Proposal B",
  "b body",
].join("\n");
assert.equal(optionSectionExcerpt(nested, "A stacked blocks").body, "a intro\n### A detail\na detail body", "a deeper heading belongs to the section");
assert.equal(optionSectionExcerpt(nested, "B compact table").body, "b body", "a sibling heading ends the section");

// A section with no prose still answers: the heading is the whole claim, and
// an empty body must not read as a rendering failure.
const headingOnly = "## Hybrid A+C";
assert.equal(optionSectionExcerpt(headingOnly, "Hybrid A+C").body, "", "a heading-only section yields an empty body, not a throw");

// A label with no section gets no excerpt either — inventing one would put
// another option's words under this option's name.
assert.equal(optionSectionExcerpt(brief, "D something else"), null, "an option with no section gets no excerpt");

assert.equal(anchorIdFor("## Anything", 3), "option-section-anything-3", "the id includes the index so duplicate headings stay distinct");
assert.equal(anchorIdFor("", 0), "option-section-0", "an empty heading still yields a usable id");

console.log("option anchor test ok: an option opens at its own section, or honestly at the top");

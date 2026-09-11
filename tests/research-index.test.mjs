import assert from "node:assert/strict";
import { parseResearchIndex, checkIndexItems } from "../lib/research-index.mjs";
import { parseResearchIndexSections, stripResearchOpportunities } from "../lib/research-index-sections.mjs";

const BRIEF = `# Research brief: onboarding
Strategy: Opportunity mapping
## Findings
People stall at the paywall step.
## Opportunities
### Opportunity mapping — 2026-09-05
- [ ] Shorter trial — reduces paywall fear
- [x] Concierge onboarding — already selected
### Jobs to be done — 2026-09-06
* [ ] Progress checklist — shows momentum
- not a checkbox, ignored
## Appendix
Extra notes.
`;

const parsed = parseResearchIndex(BRIEF);
assert.equal(parsed.found, true, "finds the Opportunities section");
assert.equal(parsed.opportunities.length, 3, "parses three checkboxes, ignores the plain bullet");
assert.deepEqual(
  parsed.opportunities.map((o) => [o.title, o.checked, o.group]),
  [
    ["Shorter trial — reduces paywall fear", false, "Opportunity mapping — 2026-09-05"],
    ["Concierge onboarding — already selected", true, "Opportunity mapping — 2026-09-05"],
    ["Progress checklist — shows momentum", false, "Jobs to be done — 2026-09-06"],
  ],
  "titles, states, and strategy groups",
);
assert.deepEqual(
  parsed.opportunities.map((o) => o.id),
  ["shorter-trial-reduces-paywall-fear-1", "concierge-onboarding-already-selected-2", "progress-checklist-shows-momentum-3"],
  "stable slug ids with positional suffix",
);
assert.ok(!parsed.opportunities.some((o) => o.title.includes("Extra")), "stops at the next h2");

// Missing or divergent briefs parse as not-found, never garbage.
assert.deepEqual(parseResearchIndex("# Brief\nNo opportunities here."), { found: false, opportunities: [] }, "missing section");
assert.deepEqual(parseResearchIndex(""), { found: false, opportunities: [] }, "empty file");
assert.deepEqual(parseResearchIndex(null), { found: false, opportunities: [] }, "null input");

// checkIndexItems flips only exact unchecked parser lines.
const ids = [parsed.opportunities[0].id, parsed.opportunities[1].id, "nope-99"];
const flipped = checkIndexItems(BRIEF, ids);
assert.deepEqual(flipped.checked, [parsed.opportunities[0].id], "flips the unchecked match only");
assert.match(flipped.updated, /- \[x\] Shorter trial/, "box checked in place");
assert.match(flipped.updated, /- \[x\] Concierge onboarding — already selected/, "already-checked line untouched");
const again = checkIndexItems(flipped.updated, ids);
assert.deepEqual(again.checked, [], "second flip is a no-op (idempotent)");
assert.equal(checkIndexItems(BRIEF, []).checked.length, 0, "empty selection flips nothing");

console.log("research index test ok: section bounds, groups, ids, idempotent flip");

// ---- Section parsing (Summary + Outputs table) ----

const FULL = `# Research index: rodar estrategia

## Summary
First paragraph of the synthesis with evidence limits.

Second paragraph, still summary.

## Outputs
| Strategy | Round | Output | Artifact | Notes |
| --- | --- | --- | --- | --- |
| Evolutionary strategy | 1 | Evolutionary diagnosis, stepping-stones, forces | .stelow/2026-09-09/pw-abc/rounds/evolutionary-r1-20260909-0035.md | Web-first research |
| Jobs to be done | 2 | Job map steps | .stelow/2026-09-09/pw-abc/rounds/jtbd-r2-20260909-0100.md | second round |

## Opportunities
### Evolutionary strategy — 2026-09-09
- [ ] Close the loop — reason
### Jobs to be done — 2026-09-09
- [ ] Run a study — another reason
`;

const sections = parseResearchIndexSections(FULL);
assert.equal(sections.summary.includes("First paragraph of the synthesis"), true, "summary keeps its prose");
assert.equal(sections.summary.includes("Second paragraph"), true, "summary keeps multiple paragraphs");
assert.equal(sections.summary.includes("## Outputs"), false, "summary stops at ## Outputs");
assert.equal(sections.summary.includes("Opportunities"), false, "summary never includes the opportunities section");
assert.equal(sections.outputs.length, 2, "parses both data rows");
assert.deepEqual(sections.outputs[0], {
  strategy: "Evolutionary strategy",
  round: "1",
  output: "Evolutionary diagnosis, stepping-stones, forces",
  path: ".stelow/2026-09-09/pw-abc/rounds/evolutionary-r1-20260909-0035.md",
  notes: "Web-first research",
}, "row one maps columns by header");
assert.equal(sections.outputs[1].round, "2", "second row keeps its own cells");
assert.deepEqual(sections.outputs[1].notes, "second round", "notes column read");

// Missing sections degrade to named empties, never throw.
assert.deepEqual(parseResearchIndexSections("# Index\nNo sections."), { summary: null, outputs: [] }, "no headings at all");
const summaryOnly = parseResearchIndexSections("## Summary\nOnly a summary here.\n");
assert.equal(summaryOnly.summary, "Only a summary here.", "summary without outputs");
assert.deepEqual(summaryOnly.outputs, [], "no outputs when no table");
const noTable = parseResearchIndexSections("## Summary\nProse.\n## Outputs\nNo table here.\n## Opportunities\n- [ ] x\n");
assert.equal(noTable.outputs.length, 0, "outputs table without a separator row is not parsed");
assert.deepEqual(parseResearchIndexSections(null), { summary: null, outputs: [] }, "null input");

// stripResearchOpportunities removes only the final section, for the
// malformed-index fallback where the raw body still renders.
const stripped = stripResearchOpportunities(FULL);
assert.equal(stripped.includes("## Opportunities"), false, "opportunities section removed");
assert.equal(stripped.includes("## Summary"), true, "summary kept");
assert.equal(stripped.includes("## Outputs"), true, "outputs kept");
assert.equal(stripResearchOpportunities("# Index\nNo opportunities."), "# Index\nNo opportunities.", "no section, unchanged");
assert.equal(stripResearchOpportunities(null), "", "null input");

console.log("research index sections test ok: summary, outputs table, opportunities stripped");

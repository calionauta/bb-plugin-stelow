import assert from "node:assert/strict";
import { parseResearchIndex, checkIndexItems } from "../lib/research-index.mjs";

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

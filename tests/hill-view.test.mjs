import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Hill view: board position from data the board already carries (hill
// fraction per card), dots as real buttons opening the same surface as
// tiles and rows. A dot that renders but opens nothing — or a view that
// fetches anything new — fails here.
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const app = readFileSync(join(root, "app.tsx"), "utf8");
const pills = readFileSync(join(root, "components", "dashboard", "build-status-pills.tsx"), "utf8");

// Third view mode beside board and list, on all three tracks: position
// over columns for the glanceable question, columns kept for operation.
assert.match(app, /\{ value: "hill" as const, title: "Hill view"/, "the view toggle offers Hill view");
for (const track of ["BuildList", "ResearchList", "ExploreList"]) {
  assert.match(app, new RegExp(`<HillBoard cards=\\{Object\\.values\\(grouped\\)\\.flat\\(\\)\\} navigate=\\{navigate\\} \\/>`), `${track} hill plots the same filtered set as its board`);
}
assert.ok((app.match(/<HillBoard cards=\{Object\.values\(grouped\)\.flat\(\)\} navigate=\{navigate\} \/>/g) ?? []).length >= 3, "all three tracks share one hill component");

// Dots carry position, curve height, and lane from lib/hill-position —
// never inline math in the view — and open through the shared navigator.
const hillAt = app.indexOf("function HillBoard({ cards, navigate }");
assert.ok(hillAt >= 0, "the hill component exists");
const hillEnd = app.indexOf("\n}\n", hillAt);
const hillBody = app.slice(hillAt, hillEnd);
assert.ok(hillBody.includes("hillPoint(card)"), "dots position through the lib, not inline math");
assert.ok(hillBody.includes("goToCard(navigate, card, card.id)"), "dots open the same card surface as tiles and rows");
assert.ok(hillBody.includes('role="status"'), "the uphill/executing tally announces");
assert.ok(hillBody.includes("aria-label={`Open card"), "dots name their card and completion for assistive tech");
assert.ok(hillBody.includes("Figuring out") && hillBody.includes("Executing"), "halves read as work states, not coordinates");
assert.ok(hillBody.includes('role="group"'), "dots group under one labelled landmark");
assert.ok(hillBody.includes('aria-label="Hill legend"'), "dot colors decode through a legend, not memory");
assert.ok(hillBody.includes("activityDotTone(card)"), "dot tones resolve through one helper, not inline ternaries");
assert.ok(hillBody.includes("before:-inset-2"), "12px dots carry an invisible 28px hit area for touch");

// Scope strips: one shared bar in tiles and rows, fed by summary counts —
// never a pasted shape per surface, never rendered for scopeless cards.
assert.match(pills, /export function ScopeStrip\(\{ done, total \}/, "one strip component serves every surface");
assert.match(app, /<ScopeStrip done=\{card\.scopeSummary\.scopesDone\} total=\{card\.scopeSummary\.scopesTotal\} \/>/, "tiles render the shared strip");
assert.match(app, /<ScopeStrip done=\{summary\.scopesDone\} total=\{summary\.scopesTotal\} \/>/, "rows render the shared strip");
assert.ok(pills.includes("if (!(total > 0)) return null"), "scopeless cards render nothing, not an empty bar");

// Phase rail: the four workflow phases with the card's own checkpoint
// filled, on build detail headers only — research/explore cards render no
// marker rather than a wrong one.
assert.match(app, /<PhaseRail stage=\{card\.stage\} \/>/, "build detail headers carry the rail");
assert.match(app, /STAGE_TO_BAND\[stage\]/, "the marker resolves through the stage vocabulary, never a pasted map");

console.log("hill view test ok: shared hill, strips, and rail from board data");

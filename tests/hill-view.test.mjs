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

// Third view mode on the Build track only: research/explore cards carry
// no scopes and non-workflow stages, so a hill there would pile every dot
// at zero and lie. Their toggles offer board and list alone.
assert.match(app, /\{ value: "hill" as const, title: "Hill view"/, "the view toggle offers Hill view");
assert.match(app, /<ViewToggle view=\{viewMode\} onChange=\{setViewMode\} label="Build cards view" \/>/, "build offers all three views");
assert.match(app, /<ViewToggle view=\{viewMode\} onChange=\{setViewMode\} label="Research cards view" views=\{\["board", "list"\]\} \/>/, "research hides the meaningless hill");
assert.match(app, /<ViewToggle view=\{viewMode\} onChange=\{setViewMode\} label="Explore cards view" views=\{\["board", "list"\]\} \/>/, "explore hides the meaningless hill");
assert.equal((app.match(/<HillBoard cards=\{Object\.values\(grouped\)\.flat\(\)\} navigate=\{navigate\} \/>/g) ?? []).length, 1, "one hill render, on the build board");

// Dots sit ON one shared curve (hillCurvePoints draws the path, dots read
// the same y) and never jitter x: crowding resolves into count pills
// anchored at their leftmost card. Hover or tap previews one floating
// panel — a full card for lone dots, compact rows for clusters.
const hillAt = app.indexOf("function HillBoard({ cards, navigate }");
assert.ok(hillAt >= 0, "the hill component exists");
const hillEnd = app.indexOf("\n}\n", hillAt);
const hillBody = app.slice(hillAt, hillEnd);
assert.ok(hillBody.includes("hillPoint(card)"), "dots position through the lib, not inline math");
assert.ok(hillBody.includes("hillCurvePoints(41)"), "the drawn curve samples the same formula as the dots");
assert.ok(hillBody.includes('role="status"'), "the uphill/executing tally announces");
assert.ok(hillBody.includes("aria-label={`Preview card"), "dots name their card and completion for assistive tech");
assert.ok(hillBody.includes("Figuring out") && hillBody.includes("Executing"), "halves read as work states, not coordinates");
assert.ok(hillBody.includes('aria-label="Hill legend"'), "dot colors decode through a legend, not memory");
assert.ok(hillBody.includes("activityDotTone(cluster.cards[0])"), "dot tones resolve through one helper, not inline ternaries");
assert.ok(hillBody.includes("before:-inset-2"), "12px dots carry an invisible 28px hit area for touch");
assert.ok(app.includes("function HillClusterPanel({"), "one panel serves lone dots and clusters alike");
assert.ok(app.includes("activityDotTone(card)"), "cluster rows tint through the same helper as dots");
assert.ok(app.includes("<BoardCard card={cluster.cards[0]!}"), "lone dots preview the same card tile as the board");
assert.ok(app.includes('role="dialog"'), "the floating preview announces as a dialog");
assert.ok(app.includes('aria-label="Close preview"'), "the preview dismisses through a labelled control");
assert.ok(hillBody.includes('event.key === "Escape"'), "Escape dismisses the preview from the keyboard");

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

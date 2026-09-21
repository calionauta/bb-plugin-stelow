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
// anchored at their leftmost card. Click-only: a cluster opens a gallery
// modal naming its cards; a lone dot opens its card directly. Hover never
// previews anything — the floating panel anchored to the frame edge, not
// the dot, and could bleed off-screen.
const hillAt = app.indexOf("function HillBoard({ cards, navigate }");
assert.ok(hillAt >= 0, "the hill component exists");
const hillEnd = app.indexOf("\n}\n", hillAt);
assert.ok(hillEnd > hillAt, "the hill component body is bounded");
const hillBody = app.slice(hillAt, hillEnd);
assert.ok(hillBody.includes("hillPoint(card)"), "dots position through the lib, not inline math");
assert.ok(hillBody.includes("hillCurvePoints(41)"), "the drawn curve samples the same formula as the dots");
assert.ok(hillBody.includes('role="status"'), "the uphill/executing tally announces");
assert.ok(hillBody.includes("aria-label={`Open card"), "dots name their card for assistive tech, never a number");
assert.ok(hillBody.includes("Figuring out") && hillBody.includes("Executing"), "halves read as work states, not coordinates");
assert.ok(hillBody.includes('aria-label="Hill legend"'), "dot colors decode through a legend, not memory");
assert.ok(hillBody.includes("activityDotTone(cluster.cards[0])"), "dot tones resolve through one helper, not inline ternaries");
assert.ok(hillBody.includes("before:-inset-2"), "12px dots carry an invisible 28px hit area for touch");
assert.ok(!hillBody.includes("scheduleOpen") && !hillBody.includes("onMouseEnter") && !hillBody.includes("HillClusterPanel"), "no hover path and no floating panel remain — click is the only opener");
assert.ok(hillBody.includes("onClick={() => goToCard(navigate, cluster.cards[0]"), "lone dots open their card directly, not a preview");
assert.ok(hillBody.includes("<CardGalleryDialog"), "clusters open the shared gallery modal");

// Progress never reads as a percentage anywhere on the hill or the card:
// counts, bars, and region words instead. A reintroduced "% complete"
// fails here first.
assert.doesNotMatch(app, /% complete/, "no percent-complete copy survives on dots, labels, or rows");
assert.doesNotMatch(app, /\{scopePct\}%/, "the scope bar carries no percent readout");
assert.doesNotMatch(app, /\{taskPct\}%/, "the task bar carries no percent readout");
assert.ok(app.includes("function hillRegionLabel("), "region words come from one helper, not pasted ternaries");

// The gallery modal: one dialog per open cluster, rows in the tile
// vocabulary (status dot, name, project, scope counts), choosing a row
// opens the same card surface as tiles and rows. Escape and overlay
// dismissal ride the shared Dialog primitive, not a bespoke key handler.
// Buckets reuse the same dialog through params (see kanban-layout) —
// never a second modal.
assert.ok(app.includes("function CardGalleryDialog({ open, title, description, cards, emptyText, onOpenCard, onClose }"), "one gallery dialog serves buckets and hill piles through params");
assert.ok(app.includes("<Dialog open={open} onOpenChange="), "dismissal rides the shared Dialog primitive");
assert.ok(app.includes("<DialogTitle>{title}</DialogTitle>"), "the dialog titles from params — pile count plus region, never a number");
assert.ok(app.includes("<BoardCard card={card} onOpen={() => onOpenCard(card)}"), "gallery rows are the board tiles themselves — tint, borders, and activity read identically");
assert.ok(app.includes("✓ {card.scopeSummary.scopesDone}/{card.scopeSummary.scopesTotal} scopes"), "tiles read scope counts, never percentages");

// View persistence: returning from a card restores the picked view per
// track (board, list, hill) instead of resetting to board. Unknown stored
// values degrade — a corrupt key never strands the track.
assert.match(app, /buildView: "stelow-build-view-v1"/, "each track owns its view key");
assert.match(app, /function useBoardView\(storageKey: string\)/, "one hook serves all three tracks");
assert.match(app, /useBoardView\(STORAGE_KEYS\.buildView\)/, "build restores its view");
assert.match(app, /useBoardView\(STORAGE_KEYS\.researchView\)/, "research restores its view");
assert.match(app, /useBoardView\(STORAGE_KEYS\.exploreView\)/, "explore restores its view");

// Dot area grows with slice size (never x jitter): a 10-scope slice reads
// bigger than a 1-scope one at the same honest position.
assert.match(app, /const biggest = Math\.max\(\.\.\.cluster\.cards\.map\(\(card\) => card\.scopeSummary\?\.scopesTotal \?\? 0\)\);/, "size reads slice volume, not position");
assert.match(app, /biggest >= 8 \? "size-5" : biggest >= 4 \? "size-4" : "size-3"/, "three size tiers, documented thresholds");

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

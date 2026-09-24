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
const hillBoard = readFileSync(join(root, "components/board/hill-board.tsx"), "utf8");
const boardCards = readFileSync(join(root, "components/board/board-cards.tsx"), "utf8");
const cardGallery = readFileSync(join(root, "components/board/card-gallery.tsx"), "utf8");
const viewToggle = readFileSync(join(root, "components", "board", "board-view-toggle.tsx"), "utf8");
const lists = readFileSync(join(root, "components", "board", "track-lists.tsx"), "utf8");
const pills = readFileSync(join(root, "components", "dashboard", "build-status-pills.tsx"), "utf8");
const manageHeader = readFileSync(join(root, "components", "manage", "card-detail-header.tsx"), "utf8");

// Third view mode on the Build track only: research/explore cards carry
// no scopes and non-workflow stages, so a hill there would pile every dot
// at zero and lie. Their toggles offer board and list alone.
assert.match(viewToggle, /\{ value: "hill", title: "Hill view"/, "the shared view toggle offers Hill view");
assert.match(app, /<ViewToggle[^>]*track="build"[^>]*label="Build cards view"/, "build opts into all three track views");
assert.match(app, /<ViewToggle[^>]*track="research"[^>]*label="Research cards view"/, "research opts into the lightweight track restriction");
assert.match(app, /<ViewToggle[^>]*track="explore"[^>]*label="Explore cards view"/, "explore opts into the lightweight track restriction");
assert.match(
  app,
  /<HillBoard cards=\{Object\.values\(grouped\)\.flat\(\)\} onOpenCard=\{\(card\) => goToCard\(navigate, card, card\.id\)\} \/>/,
  "the lone build hill mounts once and forwards its card through the shared navigator",
);

// Dots sit ON one shared curve (hillCurvePoints draws the path, dots read
// the same y) and never jitter x: crowding resolves into count pills
// anchored at their leftmost card. Click-only: a cluster opens a gallery
// modal naming its cards; a lone dot opens its card directly. Hover never
// previews anything — the floating panel anchored to the frame edge, not
// the dot, and could bleed off-screen.
assert.ok(hillBoard.includes("export function HillBoard("), "the hill component exists");
const hillBody = hillBoard;
assert.ok(hillBody.includes("hillPoint(card)"), "dots position through the lib, not inline math");
// Truthful counting: only cards still in the workflow get dots, and the line
// separates done from executing. The old inline tally counted every grouped
// card — archived ones included — and called the right half "executing", so
// a board with nothing running still read "9 executing".
assert.ok(hillBody.includes("cards.filter(isOnHill)"), "archived cards are filtered out of the dots");
assert.ok(hillBody.includes("hillTally(cards)"), "the tally comes from the lib rule, not an inline subtraction");
assert.ok(hillBody.includes("tally.done"), "done cards are counted as done");
assert.ok(!hillBody.includes("cards.length - uphill"), "no inline tally survives");
assert.ok(hillBody.includes("archived, off the hill"), "the line names the missing cards once, in three words");
assert.ok(hillBody.includes("hillCurvePoints(41)"), "the drawn curve samples the same formula as the dots");
assert.ok(hillBody.includes('role="status"'), "the uphill/executing tally announces");
assert.ok(hillBody.includes("aria-label={`Open card"), "dots name their card for assistive tech, never a number");
assert.ok(hillBody.includes("Figuring out") && hillBody.includes("Executing"), "halves read as work states, not coordinates");
assert.ok(hillBody.includes('aria-label="Hill legend"'), "dot colors decode through a legend, not memory");
assert.ok(hillBody.includes("activityDotTone(firstCard)"), "dot tones resolve through one helper, not inline ternaries");
assert.ok(hillBoard.includes("before:-inset-2"), "12px dots carry an invisible 28px hit area for touch");
assert.ok(!hillBody.includes("scheduleOpen") && !hillBody.includes("onMouseEnter") && !hillBody.includes("HillClusterPanel"), "no hover path and no floating panel remain — click is the only opener");
assert.ok(hillBody.includes("onClick={() => onOpenCard(firstCard)"), "lone dots open their card directly, not a preview");
assert.ok(hillBody.includes("<CardGalleryDialog"), "clusters open the shared gallery modal");

// Progress never reads as a percentage anywhere on the hill or the card:
// counts, bars, and region words instead. A reintroduced "% complete"
// fails here first.
assert.doesNotMatch(hillBoard, /% complete/, "the extracted hill surface carries no percent-complete copy");
assert.doesNotMatch(app, /\{scopePct\}%/, "the scope bar carries no percent readout");
assert.doesNotMatch(app, /\{taskPct\}%/, "the task bar carries no percent readout");
assert.ok(hillBoard.includes("function hillRegionLabel("), "region words come from one private helper, not pasted ternaries or public test-only API");

// The gallery modal: one dialog per open cluster, rows in the tile
// vocabulary (status dot, name, project, scope counts), choosing a row
// opens the same card surface as tiles and rows. Escape and overlay
// dismissal ride the shared Dialog primitive, not a bespoke key handler.
// Buckets reuse the same dialog through params (see kanban-layout) —
// never a second modal.
assert.ok(cardGallery.includes("export function CardGalleryDialog({"), "one gallery dialog serves buckets and hill piles through params");
assert.ok(cardGallery.includes("onOpenChange={(next) =>"), "dismissal rides the shared Dialog primitive");
assert.ok(cardGallery.includes("<DialogTitle>{title}</DialogTitle>"), "the dialog titles from params — pile count plus region, never a number");
assert.match(boardCards, /export function BoardCard\(/, "the gallery reuses the extracted board tile component");
assert.match(
  cardGallery,
  /onOpen=\{\(\) => onOpenCard\(card\)\}/,
  "the gallery mount passes its real open-card action into that component",
);
assert.doesNotMatch(hillBoard, /function CardGalleryDialog/, "the hill does not fork a private gallery modal");
assert.ok(
  boardCards.includes("✓ {card.scopeSummary.scopesDone}/{card.scopeSummary.scopesTotal} scopes"),
  "tiles read scope counts, never percentages",
);

// View persistence: returning from a card restores the picked view per
// track (board, list, hill) instead of resetting to board. Unknown stored
// values degrade — a corrupt key never strands the track.
assert.match(app, /buildView: "stelow-build-view-v1"/, "each track owns its view key");
assert.match(app, /function useBoardView\(storageKey: string, track: BoardTrack\)/, "one hook serves all three tracks with their restrictions");
assert.match(app, /useBoardView\(STORAGE_KEYS\.buildView, "build"\)/, "build restores its view against the build restriction");
assert.match(app, /useBoardView\(STORAGE_KEYS\.researchView, "research"\)/, "research restores its view against the lightweight restriction");
assert.match(app, /useBoardView\(STORAGE_KEYS\.exploreView, "explore"\)/, "explore restores its view against the lightweight restriction");

// Dot area grows with slice size (never x jitter): a 10-scope slice reads
// bigger than a 1-scope one at the same honest position.
assert.match(
  hillBoard,
  /Math\.max\(\s*\.\.\.cluster\.cards\.map\(\s*\(card\) => card\.scopeSummary\?\.scopesTotal \?\? 0\s*\),?\s*\)/,
  "dot size reads the cluster's scope volume, never position or another card metric",
);
assert.match(hillBoard, /biggest >= 8 \? "size-5" : biggest >= 4 \? "size-4" : "size-3"/, "three size tiers, documented thresholds");

// Scope strips: one shared bar in tiles and rows, fed by summary counts —
// never a pasted shape per surface, never rendered for scopeless cards.
assert.match(pills, /export function ScopeStrip\(\{ done, total \}/, "one strip component serves every surface");
assert.match(boardCards, /<ScopeStrip done=\{card\.scopeSummary\.scopesDone\} total=\{card\.scopeSummary\.scopesTotal\} \/>/, "tiles render the shared strip");
assert.match(lists, /<ScopeStrip done=\{card\.scopeSummary\.scopesDone\} total=\{card\.scopeSummary\.scopesTotal\} \/>/, "rows render the shared strip");
assert.ok(pills.includes("if (!(total > 0)) return null"), "scopeless cards render nothing, not an empty bar");

// Phase rail: the four workflow phases with the card's own checkpoint
// filled, on build detail headers only — research/explore cards render no
// marker rather than a wrong one.
assert.match(manageHeader, /<PhaseRail stage=\{card\.stage\} \/>/, "build detail headers carry the rail");
assert.match(manageHeader, /STAGE_TO_BAND\[stage\]/, "the marker resolves through the stage vocabulary, never a pasted map");

console.log("hill view test ok: shared hill, strips, and rail from board data");

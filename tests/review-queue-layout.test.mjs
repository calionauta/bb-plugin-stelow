import assert from "node:assert/strict";
// The host runtime must exist before any component imports the plugin SDK.
import "./helpers/bb-runtime-stub.mjs";
import { createElement as h } from "react";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { ReviewQueue, REVIEW_QUEUE_RAIL_ID, REVIEW_QUEUE_TRIGGER_ID } from "../components/board/review-queue.tsx";
import {
  REVIEW_QUEUE_GATES,
  REVIEW_QUEUE_ROW_PX,
  REVIEW_QUEUE_WIDTH_PX,
} from "../lib/review-queue.mjs";
import { kanbanGridColumns } from "../lib/kanban-layout.mjs";
import { BUILD_BOARD_VISIBLE_COLUMNS } from "../lib/workflow-vocabulary.mjs";

/**
 * The rail costs the board nothing.
 *
 * This is the layout claim the product gate fixed: opening the queue must not
 * narrow a column, must not add padding to the track, and must not reset the
 * board's horizontal scroll. At 1024px the board is already at its limit — the
 * four visible columns ask for up to 4 × 320px of `minmax(240px, 320px)` tracks,
 * so the track scrolls and the rightmost column is only ever reached by
 * scrolling. An in-flow 280px rail would take a column and a half out of that,
 * which is exactly what "pk you can't see the board anymore" was about.
 *
 * Asserted on a rendered scene rather than on class strings, in the idiom the
 * other layout tests use. Two things are measured here that a class cannot
 * answer: the rail's computed `position` (out of flow is the whole mechanism)
 * and the track's scroll position across an open/close. What this DOM cannot
 * measure is `scrollWidth` — happy-dom does no layout, so every width is 0 —
 * so the rightmost column's reachability is asserted as its cause: the track
 * keeps its horizontal overflow, and nothing takes width from it.
 */

const DAY = 86_400_000;
const T = Date.now();
const PRODUCT_GATE = REVIEW_QUEUE_GATES[0].id;
const CODE_GATE = REVIEW_QUEUE_GATES[3].id;

const rpc = () => ({
  calls: [],
  call: async () => ({
    notifications: [{ cardId: "c1", kind: "completed", occurredAt: T - 5 * DAY, readAt: null, resolvedAt: null, archivedAt: null }],
  }),
});

/** The board's four visible columns, at the width where it starts to scroll. */
function boardScene() {
  const track = document.createElement("div");
  track.setAttribute("data-testid", "kanban-board");
  track.setAttribute("style", "width:1024px;overflow-x:auto;display:flex");
  for (const column of BUILD_BOARD_VISIBLE_COLUMNS) {
    const cell = document.createElement("div");
    cell.setAttribute("data-testid", `column-${column}`);
    cell.setAttribute("style", "width:300px;flex:0 0 auto");
    track.append(cell);
  }
  const chrome = document.createElement("div");
  chrome.setAttribute("data-testid", "chrome");
  document.body.append(chrome, track);
  return { chrome, track };
}

// One track per column. The template is a space-separated list of `minmax(...)`
// functions whose arguments contain spaces, so splitting on whitespace counts
// twice per track — the tracks are what these assertions are about.
const gridTracks = (template) => template.match(/minmax\([^)]*\)|[0-9.]+px/g) ?? [];
const gridOf = () => gridTracks(kanbanGridColumns(BUILD_BOARD_VISIBLE_COLUMNS, {}));

// The premise the rest of the file rests on: at 1024 the tracks do not fit.
const tracks = gridOf();
assert.equal(
  tracks.length,
  BUILD_BOARD_VISIBLE_COLUMNS.length,
  "one track per visible column, before the queue is involved at all",
);
const minTrackPx = Number(tracks[0].match(/minmax\((\d+)px/)[1]);
assert.ok(
  minTrackPx * tracks.length > 1024,
  `the board's own minimum (${minTrackPx}px × ${tracks.length}) already exceeds 1024px, so the track scrolls and a column is reached by scrolling`,
);

const { chrome, track } = boardScene();
track.scrollLeft = 700;
const paddingBefore = getComputedStyle(track).paddingRight;
const templateBefore = kanbanGridColumns(BUILD_BOARD_VISIBLE_COLUMNS, {});
const overflowBefore = getComputedStyle(track).overflowX;

const cards = [
  { id: "c1", displayName: "Card one", stage: PRODUCT_GATE, activity: "idle", updatedAt: T },
  { id: "c2", displayName: "Card two", stage: CODE_GATE, activity: "idle", updatedAt: T },
];
render(h(ReviewQueue, { rpc: rpc(), cards, onOpenCard: () => {} }), { container: chrome });
const trigger = () => document.getElementById(REVIEW_QUEUE_TRIGGER_ID);
await waitFor(() => assert.equal(trigger().getAttribute("aria-expanded"), "false"));

fireEvent.click(trigger());
const rail = document.getElementById(REVIEW_QUEUE_RAIL_ID);
assert.ok(rail, "the rail is open");
const railStyle = getComputedStyle(rail);

// --- 1. Out of flow, so it cannot take width from the board ---------------
assert.equal(
  railStyle.position,
  "fixed",
  "the rail is fixed: an in-flow panel is a panel that takes a column away",
);
assert.equal(railStyle.right, "0px", "and it is anchored to the viewport's right edge, not to a column");
assert.equal(railStyle.width, `${REVIEW_QUEUE_WIDTH_PX}px`, "the width is the published 280px, not a class string");
assert.equal(railStyle.zIndex, "40", "it sits over the chrome rather than pushing it");
assert.equal(
  document.querySelectorAll("[data-review-queue-rail]").length,
  1,
  "one fixed element, so there is no second in-flow copy to squeeze the grid",
);

// --- 2. The grid, the padding and the overflow are untouched -------------
assert.equal(
  kanbanGridColumns(BUILD_BOARD_VISIBLE_COLUMNS, {}),
  templateBefore,
  "opening the rail does not change the board's tracks",
);
assert.equal(tracks.length, BUILD_BOARD_VISIBLE_COLUMNS.length, "and drops no column to make room");
assert.equal(
  getComputedStyle(track).paddingRight,
  paddingBefore,
  "no width is carved out of the track as padding, which is how an overlay becomes an in-flow panel",
);
assert.equal(getComputedStyle(track).overflowX, overflowBefore, "the track is still a horizontal scroller");
assert.equal(getComputedStyle(track).overflowX, "auto", "so the rightmost column is still reachable by scrolling it");

// --- 3. The scroll the reader left survives ------------------------------
assert.equal(track.scrollLeft, 700, "the board stays where the reader left it while the rail is open");
fireEvent.click(trigger());
assert.equal(document.getElementById(REVIEW_QUEUE_RAIL_ID), null, "closed");
assert.equal(track.scrollLeft, 700, "and closing it does not jump the board either");

// --- 4. Nothing the component renders is sized like the board's loss -----
// The way an overlay quietly becomes an in-flow panel is a wrapper that pays for
// it: padding, a margin, or a spacer as wide as the rail. The rail is the only
// thing this component renders that carries the published width.
assert.equal(
  REVIEW_QUEUE_ROW_PX,
  44,
  "a row is 44px: the touch-target floor the rest of the app holds itself to",
);
assert.equal(
  Array.from(chrome.querySelectorAll("*")).filter(
    (element) => getComputedStyle(element).paddingRight === `${REVIEW_QUEUE_WIDTH_PX}px`,
  ).length,
  0,
  "no element in the queue's own chrome pays the rail's width as padding",
);

// --- 5. The rail is not inside the track it would otherwise affect -------
fireEvent.click(trigger());
assert.equal(
  track.contains(document.getElementById(REVIEW_QUEUE_RAIL_ID)),
  false,
  "the rail is a sibling of the board, not a child of its scroll container",
);
assert.equal(track.contains(trigger()), false, "and so is its trigger: the chrome line is above the board");

// --- 5b. The far column is reached by scrolling, with the rail open -------
//
// A1 and A2 of the audit: the end of the track is *reachable*, and a scroll
// gesture while the rail is open still moves the board. This DOM has no layout
// engine, so what is asserted is the mechanism and its arithmetic -- the track's
// own scroll extent, the position taken to its end, and the board moving while
// the panel stays mounted -- not a painted pixel. A browser look is recorded as
// the residual gap in the change report rather than pretended here.
const openRail = document.getElementById(REVIEW_QUEUE_RAIL_ID);
const maxScrollPx = minTrackPx * tracks.length - 1024;
assert.ok(maxScrollPx > 0, `${maxScrollPx}px of track sits off-screen at 1024px, so the end is a scroll away`);
track.scrollLeft = maxScrollPx;
fireEvent.scroll(track);
assert.equal(
  track.scrollLeft,
  maxScrollPx,
  "A1: the far end is a scroll position the board takes while the rail is open",
);
assert.equal(
  getComputedStyle(track).overflowX,
  "auto",
  "A1: and the element that scrolls there is still the track, not the panel",
);
track.scrollLeft = 0;
fireEvent.scroll(track);
track.scrollLeft = 480;
fireEvent.scroll(track);
assert.equal(track.scrollLeft, 480, "A2: a horizontal scroll while the rail is open moves the board");
const beforeWheel = track.scrollLeft;
fireEvent.wheel(openRail, { deltaX: 400, deltaY: 0 });
assert.equal(
  track.scrollLeft,
  beforeWheel,
  "A2: a wheel gesture over the rail does not move the board -- the panel neither captures nor forwards it",
);
assert.equal(
  document.getElementById(REVIEW_QUEUE_RAIL_ID),
  openRail,
  "A2: and moving the board neither closes nor remounts the panel",
);
assert.equal(
  track.contains(openRail),
  false,
  "A2: the two never share a scroll position, because the rail is outside the scrolling element",
);
cleanup();

// --- 6. Shutting it leaves no residue ------------------------------------
assert.equal(
  document.querySelectorAll("[data-review-queue-rail]").length,
  0,
  "a closed rail is unmounted, not hidden: nothing invisible keeps measuring the board",
);

console.log("review queue layout test ok");

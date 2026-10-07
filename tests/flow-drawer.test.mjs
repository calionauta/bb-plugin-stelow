import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { codeOf } from "./helpers/source-code.mjs";

/**
 * The flow detail is a side drawer, not an accordion in the board's column.
 *
 * Reported: "a barra de flow ta em um lugar ruim tambem e qdo abre ta mal apresentada".
 *
 * It expanded IN PLACE, inside the board's own column, and then clamped its lists to
 * `max-h-56` — a scroll box inside a board that is itself a scrolling surface, pushing the
 * board down to make room for the thing describing it.
 *
 * The summary line stays on the board: it is a status reading, and a reader should not have
 * to open a panel to see how many cards finished. The detail moves to a right-side drawer,
 * which is full height for the lists and leaves the board visible beside it — so a name in
 * the list can be compared against the card it came from.
 *
 * The shell is shared rather than copied. `side` is a prop on the drawer the app already
 * uses, because the portal, the focus trap, the dismiss gesture and the settle animation are
 * the same mechanism on both edges, and the focus handling is the part nobody notices
 * breaking.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const strip = codeOf(readFileSync(join(root, "components/board/flow-strip.tsx"), "utf8"));
const shell = codeOf(readFileSync(join(root, "components/ui/persistent-responsive-drawer-shell.tsx"), "utf8"));
// The per-edge strings live in lib/drawer-side.mjs: they are a placement rule, and the
// shell crossed its function budget holding them. The pins read the owner.
const sides = codeOf(readFileSync(join(root, "lib/drawer-side.mjs"), "utf8"));
// The drawer's contents moved to their own file when the strip crossed its budget, so the
// clamp pin reads where the lists actually render.
const details = codeOf(readFileSync(join(root, "components/board/flow-drawer-details.tsx"), "utf8"));
const wrapper = codeOf(readFileSync(join(root, "components/ui/responsive-drawer-shell.tsx"), "utf8"));

// --- 1. The detail renders in a drawer, not in the board's column. ----------
assert.match(
  strip,
  /<ResponsiveDrawerShell[\s\S]*?side="right"/,
  "the flow detail renders in a right-side drawer",
);
assert.match(strip, /srLabel="Flow indicators"/, "the drawer is labelled for assistive tech, since its title is visual");
assert.match(
  strip,
  /setOpen\(false\);\s*\n\s*onOpenCard\(kind, cardId\);/,
  "opening a card from the drawer closes it first, so the card is not hidden behind the panel that opened it",
);

// --- 2. The summary line survives on the board. -----------------------------
// A drawer-only flow reading would be worse than the accordion: the point of the line is to
// be visible without an interaction.
// Rendered unconditionally: a guard around it is how the line disappears from the board
// while a test that greps for the name stays green.
assert.match(
  strip,
  /<div className="rounded-md border bg-muted\/20 px-3 py-2">\s*\n\s*<FlowSummaryHeader/,
  "the one-line summary renders on the board with no condition between the column and it",
);
// The board column holds the summary and nothing else. Asserted by POSITION rather than by
// presence: `FlowSummaryHeader` appearing anywhere satisfies a presence check, and the defect
// is a detail block in the wrong container. The column's div must close before the drawer
// opens, and the detail component must sit after that close.
const summaryColumn = strip.slice(strip.indexOf('<div className="rounded-md border bg-muted/20'), strip.indexOf("</div>", strip.indexOf("<FlowSummaryHeader")));
assert.ok(summaryColumn.includes("<FlowSummaryHeader"), "the summary renders inside the board's column");
assert.ok(
  !summaryColumn.includes("<FlowDetails"),
  "and the detail does not: it belongs to the drawer, not to the column that holds the board",
);
assert.ok(
  strip.indexOf("<ResponsiveDrawerShell") > strip.indexOf("<FlowSummaryHeader"),
  "the drawer opens after the summary, so the two are siblings rather than nested",
);

// --- 3. The clamps are gone: one scroll surface, not two. -------------------
assert.doesNotMatch(
  details,
  /max-h-56/,
  "the inner lists no longer clamp: the drawer scrolls as a whole, and a scroll box inside a full-height panel is two scrollbars for one list",
);
assert.match(
  strip,
  /contentClassName="overflow-y-auto p-4"/,
  "the drawer's own body is the scroll surface instead",
);

// --- 4. `side` is a prop on the shared shell, never a second component. ----
// The regression to fear is a copy: a second drawer would re-implement the focus trap, and
// the focus trap is what breaks silently.
assert.match(
  shell,
  /type DrawerSide = "bottom" \| "right";/,
  "the shell names its two sides in one place",
);
assert.match(shell, /side = "bottom"/, "and defaults to bottom, so every existing caller is untouched");
// Delegation, not a second copy of the placement rules: a shell that spelled the classes out
// again is how the two edges would drift apart.
assert.match(shell, /drawerPanelClass\(side\)/, "the shell asks the owner for the panel's box");
assert.match(shell, /drawerClosedTransform\(side\)/, "and for the transform that hides it");
assert.match(shell, /side\?: DrawerSide;/, "the prop is optional, which is what keeps the default meaningful");
assert.match(
  wrapper,
  /side\?: "bottom" \| "right";/,
  "the responsive wrapper forwards it rather than swallowing it",
);
assert.match(wrapper, /side=\{side\}/, "and passes it through to the shell");

// --- 5. The two sides differ in axis, and only in axis. --------------------
assert.match(
  sides,
  /fixed inset-y-0 right-0[\s\S]*?border-l/,
  "a right panel is full height and edge-to-edge on the left, so the board stays visible beside it",
);
assert.match(
  sides,
  /translate3d\(100%, 0, 0\)/,
  "and it enters from the right, not from the floor",
);
assert.match(
  sides,
  /translate3d\(0, 100%, 0\)/,
  "while the bottom sheet still rises, so the existing behaviour is unchanged",
);
// A grab bar advertises a drag-to-dismiss. A right panel dismisses by backdrop or Escape, so
// rendering the handle there would advertise a gesture that does nothing.
assert.match(
  shell,
  /drawerHasGrabBar\(side\)/,
  "the shell asks the owner whether this edge has a grab bar, rather than testing the side inline",
);
assert.match(
  sides,
  /export function drawerHasGrabBar\(side\) \{\s*\n\s*return side !== "right";/,
  "and the right panel has none: it has no drag-to-dismiss, so a handle would promise a gesture that does nothing",
);

// --- 6. The drawer's width leaves the board usable. ------------------------
assert.match(
  sides,
  /w-\[min\(92vw,26rem\)\]/,
  "the panel is bounded so it never fills the viewport on a phone and never crowds a desktop board",
);

console.log("flow drawer ok: side panel for the detail, summary line still on the board, one shared shell");

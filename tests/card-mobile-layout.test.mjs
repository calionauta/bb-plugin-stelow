import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { codeOf } from "./helpers/source-code.mjs";

/**
 * The open card works at 375px, not only at desktop width.
 *
 * Reported: "no mobile a tela do stelow, tanto board quanto card aberta tao pessimas,
 * precisam ser melhor adaptadas". The board was rebuilt as a snap rail; this is the card.
 *
 * Two defects, both structural rather than cosmetic:
 *
 *   1. The header is ONE row and carried six things on a phone — Back, the breadcrumb, the
 *      status pills, the intent select, the actions menu and Close. The breadcrumb is the
 *      `flex-1` member, so it was the one that collapsed, leaving a reader with controls
 *      they can reach and no idea which card they are on.
 *   2. The content's gutters were a flat `p-4`. On a 375px screen that leaves 343px for the
 *      card's own sections, each of which adds padding on top of it.
 *
 * The fix for the first is a wrap: below `md` the breadcrumb takes a full-width line of its
 * own and the controls share the first row. The fix for the second is breakpoint gutters.
 *
 * Pinned on the class strings because that is what a future edit changes, and read with the
 * repo's comment-stripping helper so the explanation above cannot satisfy the assertion.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const header = codeOf(readFileSync(join(root, "components/manage/card-detail-header.tsx"), "utf8"));
const content = codeOf(readFileSync(join(root, "components/detail/build-detail-content.tsx"), "utf8"));

// --- 1. The header wraps instead of crushing its middle. -------------------
assert.match(
  header,
  /<header className="flex flex-wrap items-center gap-x-2 gap-y-1/,
  "the header wraps: without it the single row has to fit six controls at 375px",
);
assert.match(
  header,
  /order-last min-w-0 basis-full truncate text-xs text-muted-foreground md:order-none md:basis-auto md:flex-1/,
  "the breadcrumb takes a full-width line below md and returns to the single row at md",
);
assert.match(
  header,
  /md:order-none/,
  "and the reordering is explicitly undone at md, so desktop is unchanged rather than accidentally different",
);

// The controls that must stay reachable in the first row. Asserted by presence so a future
// reorder cannot quietly move one into the wrapped line and lose it behind a scroll.
for (const control of ["Board", "CardActionsMenu", "Close card details"]) {
  assert.ok(header.includes(control), `${control} stays in the header`);
}

// --- 2. The content's gutters adapt. ---------------------------------------
assert.match(
  content,
  /px-3 py-3 pb-24 sm:p-4 sm:pb-4/,
  "the card's gutters are tighter on a phone and return to p-4 at sm",
);
assert.doesNotMatch(
  content,
  /className="flex-1 overflow-auto p-4"/,
  "and the flat p-4 is gone: it is what left 343px of content on a 375px screen",
);
// The bottom gutter clears the floating bulk bar, which is fixed to the viewport and would
// otherwise cover the card's last section.
assert.match(
  content,
  /pb-24/,
  "and the bottom gutter clears the floating bulk bar",
);

// --- 3. The card's shell does not assume a wide viewport. ------------------
const body = codeOf(readFileSync(join(root, "components/detail/build-detail-body.tsx"), "utf8"));
assert.match(body, /flex h-full flex-col/, "the card is a full-height column, which is what makes one scrolling region possible");
assert.doesNotMatch(
  body,
  /min-w-\[\d{3,}px\]/,
  "and nothing in the card's shell demands a minimum width a phone cannot give it",
);

console.log("card mobile layout ok: the header wraps, the breadcrumb keeps its line, and the gutters adapt");

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { codeOf } from "./helpers/source-code.mjs";

/**
 * The panel header keeps its explanation readable when the panel is narrow.
 *
 * Reported: "a tela do plugin stelow quando uso em formato mais espremido,
 * seja tablet ou mobile, não consigo usar. o texto de explicação do board fica
 * espremido e longo e tudo quebra."
 *
 * The header was one row from `sm` (640px). At that width the explanation and
 * the action grid share the row, and the explanation is the member that gives
 * up its width — so the sentence that teaches the board wrapped into a tall
 * column of text beside two columns of buttons. The breakpoint said "there is
 * room here" when what it actually marked was the first width where there
 * stopped being room.
 *
 * Three things are pinned here, and each one is a separate way the defect
 * comes back:
 *
 *   1. The header stays a COLUMN until `lg`. A future edit that moves the row
 *      back to `sm` restores the squeeze with the same class names.
 *   2. The rows are rendering the shared component, not a local copy of it —
 *      three copies is how this drifted out of sync in the first place.
 *   3. The scroll hint switches on input device (touch vs keyboard), not on
 *      the `sm` width that told a 768px tablet to hold Shift.
 *
 * Asserted against the class strings because that is what a future edit
 * changes, and read through the repo's comment-stripping helper so the
 * explanation above cannot satisfy its own assertion.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function source(relativePath) {
  return readFileSync(join(root, relativePath), "utf8");
}

const headerComponent = codeOf(source("components/panels/panel-header.tsx"));
const buildView = codeOf(source("components/panels/build-panel-view.tsx"));
const trackView = codeOf(source("components/panels/track-panel-view.tsx"));

// --- 1. The header is a column until lg. ----------------------------------
assert.match(
  headerComponent,
  /className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between lg:gap-6"/,
  "the header stacks until lg: at sm the explanation had to share a row with the action grid and lost",
);
assert.doesNotMatch(
  headerComponent,
  /sm:flex-row/,
  "and no breakpoint below lg turns the header into a row",
);
assert.match(
  headerComponent,
  /max-w-prose text-pretty text-sm leading-5 text-muted-foreground/,
  "the explanation wraps at a readable measure and balances its last line",
);

// The actions: two full-width columns a thumb can hit on a phone, a wrapping
// row above that. A wrapping row cannot squeeze the title because it has no
// column to be forced into.
assert.match(
  headerComponent,
  /grid w-full grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center sm:gap-2 lg:mt-0\.5 lg:w-auto lg:flex-nowrap lg:justify-end/,
  "the actions are a phone grid and a wrapping row above it",
);
assert.doesNotMatch(
  headerComponent,
  /sm:flex-col/,
  "the actions never stack beside the explanation again",
);

// --- 2. Both tracks render the shared header. ------------------------------
for (const [name, file] of [
  ["build", buildView],
  ["track", trackView],
]) {
  assert.match(
    file,
    /<PanelHeader\b/,
    `the ${name} panel renders PanelHeader instead of its own header markup`,
  );
  assert.doesNotMatch(
    file,
    /<header className="flex flex-col gap-3/,
    `and the ${name} panel keeps no second header implementation`,
  );
}

// The build panel's explanation lives in one named constant, so the sentence
// is not re-wrapped by whatever width its JSX happened to have.
assert.match(
  buildView,
  /const BUILD_BLURB =/,
  "the build explanation is a single named string",
);
assert.match(
  buildView,
  /blurb=\{BUILD_BLURB\}/,
  "and the panel passes it to the shared header",
);

// --- 3. The scroll hint follows the input device, not the width. -----------
assert.match(
  headerComponent,
  /<span className="lg:hidden">Swipe sideways to view every stage\.<\/span>/,
  "touch widths get the swipe hint",
);
assert.match(
  headerComponent,
  /<span className="hidden lg:inline">/,
  "and the keyboard hint starts only where a keyboard is the likely input",
);
assert.doesNotMatch(
  headerComponent,
  /<span className="sm:hidden">Swipe sideways/,
  "a 768px tablet is no longer told to hold Shift",
);

// Both boards render the shared hint, wherever their own copy used to live.
for (const [name, file] of [
  ["build", buildView],
  ["track", trackView],
]) {
  assert.match(file, /<BoardScrollHint \/>/, `the ${name} board renders the shared scroll hint`);
  assert.doesNotMatch(
    file,
    /Swipe sideways to view every stage\./,
    `and the ${name} board keeps no local copy of the hint copy`,
  );
}

// --- 4. A tablet's board is not two scroll regions at once. ----------------
for (const [name, file] of [
  ["build", buildView],
  ["track", trackView],
]) {
  assert.match(
    file,
    /lg:h-\[clamp\(20rem,calc\(100dvh-17rem\),48rem\)\] lg:overflow-y-hidden/,
    `the ${name} board bounds its height only from lg, where the header above it is one row`,
  );
}

// --- 5. The loading skeleton has the header's shape. ----------------------
// A skeleton that reserves a different layout than the content it replaces is
// a layout shift dressed as a loading state.
const skeleton = codeOf(source("components/panel/track-skeleton.tsx"));
assert.match(
  skeleton,
  /<header className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between lg:gap-6">/,
  "the skeleton reserves the same header shape, so nothing jumps when content lands",
);
assert.match(
  skeleton,
  /grid w-full grid-cols-2 gap-2 sm:flex sm:flex-wrap lg:w-auto lg:flex-nowrap/,
  "including the actions row",
);

console.log(
  "panel header responsive ok: the explanation keeps its width below lg, "
  + "the scroll hint follows touch, and both tracks share one header",
);

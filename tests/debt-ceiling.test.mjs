import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The touch-target and cursor rules, counted — the half `AGENTS.md` says is missing.
 *
 * Split from `card-design-tokens.test.mjs`, which is about the design-token VOCABULARY: which
 * size is a named step, which exception earns its place. This is about the DENSITY of raw
 * elements in the tree, which is a different subject and took that file over its budget.
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function componentFiles() {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(join(repoRoot, dir), { withFileTypes: true })) {
      if (entry.isDirectory()) walk(join(dir, entry.name));
      else if (/\.(tsx?|mjs)$/.test(entry.name)) out.push(join(dir, entry.name));
    }
  };
  walk("components");
  walk("lib");
  return out;
}

const ALL = componentFiles().map((file) => file.replace(`${repoRoot}/`, ""));

/**
 * One source file's text, comments INCLUDED.
 *
 * `codeOf` strips comments, and this census deliberately does not: a button written inside a
 * comment is not a control, but the numbers this file pins against are the ones `AGENTS.md`
 * quotes, and that sentence's count is measured raw. Stripping here made the two disagree
 * about the same tree — 81 against 84 — which is exactly the drift the sentence warns about.
 * The scope is `components/` + `lib/`, the same scope `agents-ui-rules-index` measures, so
 * the two censuses cannot report different totals for one checkout.
 */
function sourceOf(relative) {
  return readFileSync(join(repoRoot, relative), "utf8");
}


/**
 * The touch-target and cursor rules are counted, because `AGENTS.md` says they are not tested.
 *
 * `AGENTS.md` records them as debt in its own words: *"`min-h-11` is the one this section is
 * least able to keep: it is stated, not tested, and 84 raw buttons are the standing
 * evidence."* That sentence is honest about the debt and silent about its SIZE — and 84 is
 * the button count, not the number of buttons breaking either rule. Measured: **69** carry no
 * `min-h-9` or larger, and **57** carry no `cursor-pointer` (84 buttons). The raw counts are
 * the honest ones the `AGENTS.md` sentence is about; `components/` + `lib/` is the scope, and
 * comments are NOT stripped, because a button written in a comment is not a control.
 *
 * A full migration is not the ask; the same reasoning as `text-[11px]` applies. What is asked
 * is that the number cannot GROW, so the debt is a ceiling rather than an open tap. Migrating
 * a button is a permanent gain, and a new raw button with neither class is caught.
 *
 * The floors are measured, not chosen: raise one only with a reason, and prefer migrating.
 */
test("the untested touch-target and cursor rules cannot grow", () => {
  // Measured on the raw text, the same way `AGENTS.md`'s own count is measured: 84 buttons,
  // 69 without a touch height, 57 without a cursor. The first version of this block stripped
  // comments and set the floors from the stripped figures, which left them 3 too high while
  // the census reported the stripped numbers — a new button fitted underneath and the test
  // stayed green. Found by adding one and watching it pass.
  const TOUCH_FLOOR = 69;
  const CURSOR_FLOOR = 57;
  let buttons = 0;
  let missingTouch = 0;
  let missingCursor = 0;
  for (const file of ALL) {
    // Joined, not per line: a `<button` whose attributes span several lines is one element,
    // and a per-line scan counted 32 of the 84 — it silently missed every multiline tag, which
    // is most of the styled ones. The count is asserted below precisely so a scan that stops
    // seeing its subject fails instead of passing on a smaller number.
    const source = sourceOf(file);
    for (const tag of source.match(/<button[^>]*>/g) ?? []) {
      buttons += 1;
      if (!/min-h-(9|10|11)|h-(9|10|11)\b/.test(tag)) missingTouch += 1;
      if (!/cursor-pointer/.test(tag)) missingCursor += 1;
    }
  }
  // The count is its own floor: if it drops sharply, this census has stopped seeing the
  // elements it measures rather than the tree having fewer of them. That check is what caught
  // the per-line version reporting 32.
  assert.ok(
    buttons >= 84,
    `the census sees the raw buttons (found ${buttons}, expected at least 84) — a lower number `
    + "means this scan stopped matching, not that the tree has fewer buttons",
  );
  assert.ok(
    missingTouch <= TOUCH_FLOOR,
    `${missingTouch} buttons carry no touch-target height against a floor of ${TOUCH_FLOOR}. `
    + "The count may only fall: a new raw button needs min-h-11, and raising the floor needs a reason",
  );
  assert.ok(
    missingCursor <= CURSOR_FLOOR,
    `${missingCursor} buttons carry no cursor-pointer against a floor of ${CURSOR_FLOOR}. `
    + "Tailwind v4 does not imply it, so a new raw button needs it explicitly",
  );
});

/**
 * The type-size debt cannot grow, which is what the docstring above kept promising.
 *
 * `text-[11px]` sits in `TYPE_EXCEPTIONS`, so it is ALLOWED — and an allowance with no count
 * is not a debt, it is permission. The earlier version of this section said "a size that was
 * not already here cannot join" and "the sites are owed a migration and are now counted";
 * neither was true, and a new site passed green. Proved by adding one before writing this.
 *
 * The scope is `components/` + `lib/`, which is the scope `agents-ui-rules-index` measures, so
 * the two censuses cannot report different totals for one checkout. A site may DISAPPEAR (the
 * migration happens) but not appear: the ceiling is a measurement of this checkout, and it
 * only ratchets down.
 */
test("the type-size debt cannot grow", () => {
  const SIZE = /text-\[\d+(?:\.\d+)?px\]/g;
  // 102 is the CANONICAL measurement: components/ + lib/, every extension, comments
  // included — the same scope agents-ui-rules-index measures its own count with. Getting here
  // took four wrong numbers (97 for a .tsx-only scan, 95 for a comment-stripped one, 66 and 54
  // for a stripped button census) and the sanity floor below caught each. Two censuses of one
  // tree that disagree are worse than one, so this file uses the canonical scope.
  const MIGRATION_DEBT = { "text-[11px]": 102 };
  const counts = {};
  for (const file of ALL) {
    for (const line of sourceOf(file).split("\n")) {
      for (const size of line.match(SIZE) ?? []) {
        counts[size] = (counts[size] ?? 0) + 1;
      }
    }
  }
  for (const [size, ceiling] of Object.entries(MIGRATION_DEBT)) {
    const actual = counts[size] ?? 0;
    // The floor too: a count far below the ceiling means this scan stopped matching rather
    // than the migration having happened, and a silent halt would read as progress.
    assert.ok(
      actual >= ceiling - 5,
      `${size} appears ${actual} times and the ceiling is ${ceiling}: a count this far below `
      + "means the census stopped seeing its subject, not that the migration completed",
    );
    assert.ok(
      actual <= ceiling,
      `${size} appears ${actual} times against a debt ceiling of ${ceiling}. The size may only `
      + "DISAPPEAR as sites migrate and must never grow: raise the ceiling only with a reason",
    );
  }
});

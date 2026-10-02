import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { TEXT_META, TEXT_SECTION, TYPE_EXCEPTIONS, TYPE_SCALE } from "../lib/design-tokens.ts";
import { codeLinesOf as stripComments, codeOf } from "./helpers/source-code.mjs";

/**
 * The card's vocabulary must be named, or it cannot be checked.
 *
 * The audit behind this file: the chevron was already shared — twelve
 * components imported it — which is exactly what made the leak easy to miss.
 * Eight of them were still hand-rolling the whole pattern around it, with seven
 * different summary paddings between them. And one constant literally named
 * `DISCLOSURE_SUMMARY_CLASS` existed in two files with DIFFERENT contents, so
 * the same "show more" rendered as a link in one place and as body text in
 * another. Meanwhile `text-[11px]` appeared 102 times: the card had a real type
 * scale, invented by whoever needed a small section heading first, and therefore
 * invisible to review — a reviewer cannot check a rule that was never stated.
 *
 * Reuse was happening, just not where it was countable. The named vocabulary is
 * what makes it countable.
 *
 * Two rules, both narrow on purpose. This does not ban a raw <details> or a raw
 * <button>: nested disclosures and quiet inline controls are legitimate, and a
 * test that bans them teaches people to work around it. It bans exactly the two
 * leaks that are invisible in review — re-spelling a named family, and inventing
 * a type size.
 */
const repoRoot = join(fileURLToPath(import.meta.url), "..", "..");
const read = (relative) => readFileSync(join(repoRoot, relative), "utf8");

function componentFiles() {
  const walk = (dir) => readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
  return walk(join(repoRoot, "components")).filter((file) => file.endsWith(".tsx"));
}

/** Source with comments stripped, so a comment naming a removed class is not code. */
function codeLinesOf(relative) {
  return stripComments(read(relative));
}

const ALL = componentFiles().map((file) => file.replace(`${repoRoot}/`, ""));

/**
 * One function's own source, from its `export function NAME(` up to the brace
 * that closes it. Extracting the block is what makes a rule about its body a
 * rule about the body: a lazy `[\s\S]*?` to the end of the file would let a
 * later sibling's dot satisfy a "this chip has no dot" check, which is a
 * green test for a chip that has one.
 */
function functionSource(relative, name) {
  const block = read(relative).match(new RegExp(`export function ${name}\\([\\s\\S]*?\\n\\}`));
  assert.ok(block, `${name} must exist as an exported function in ${relative}`);
  return block[0];
}

test("a chip that asks for something never borrows the position vocabulary", () => {
  // The review chip marks a REQUEST about finished work, so it must not use
  // the tells that mean "here is a position". The stage pill, the activity
  // pill and the attention chip all carry a dot, and on a terminal card the
  // stage pill is suppressed on purpose — which left the review chip alone in
  // the vacated slot, reading as the card's next checkpoint.
  assert.doesNotMatch(
    functionSource("components/dashboard/build-status-pills.tsx", "ReviewChip"),
    /aria-hidden/,
    "the review chip carries no dot. A dot in this vocabulary means a position, and this chip asks for a look at finished work",
  );
  assert.doesNotMatch(
    codeOf(read("components/board/board-cards.tsx")),
    /bg-emerald-500\/15/,
    "the board tile re-spelled the shared review chip and drifted a dot and a type size away from the list row",
  );
});

test("the review chip's label is not a workflow phase name", () => {
  // `review` is a phase in the stage catalog, and BUILD_BOARD_COLUMN_LABELS
  // spreads PHASE_LABELS, so the board already carries a column header that
  // reads "Review". A chip wearing that word is a position that does not
  // exist. Read the label out of the component and the phase labels out of
  // the catalog, so neither side can drift without failing here.
  const catalog = JSON.parse(read("data/stelow-stage-catalog.json"));
  const chipLabel = read("components/dashboard/build-status-pills.tsx")
    .match(/export function ReviewChip\(\{ label = "([^"]+)"/)?.[1];
  assert.ok(chipLabel, "ReviewChip must default its label, so this check reads the shipped word rather than a copy of it");
  const phaseLabels = catalog.phases.map((phase) => phase.label);
  assert.ok(
    !phaseLabels.includes(chipLabel),
    `the review chip's label is not a workflow phase name; \`review\` is one, and the board already has a column header that says Review. Got "${chipLabel}"`,
  );
});

// A state the reader cannot act on must not wear the colours of one they
// should. The host-read marker is the case: something IS wrong, it is on the
// host, and no button on the card changes it — so it must not breathe (that
// animation means "happening now, go look") and must not wear the error
// channel's red (that means "this card failed"). Asserted against the class
// lists rather than the hex values, so a palette change cannot quietly turn a
// non-actionable state into an alarming one.
test("the host-read marker is inert: no breathing, not the error channel", () => {
  const styles = read("components/app-support/stelow-styles.css");
  const rule = styles.match(/\.stelow-activity-unreadable \{([^}]*)\}/);
  assert.ok(rule, "the host-read marker must have a tone of its own, not borrow the hold's or the error's");

  const errorTone = styles.match(/\.stelow-activity-error \{([^}]*)\}/);
  assert.ok(errorTone, "the error tone is the reference this is measured against");
  for (const property of ["border-color", "color"]) {
    const marker = rule[1].match(new RegExp(`${property}:\\s*([^;]+);`))?.[1].trim();
    const error = errorTone[1].match(new RegExp(`${property}:\\s*([^;]+);`))?.[1].trim();
    assert.notEqual(marker, error, `the host-read marker must not read as the failure channel's ${property}`);
  }
  assert.doesNotMatch(
    styles.match(/\.stelow-activity-unreadable \{[^}]*\}/)[0],
    /animation/,
    "the breathing animation means \"happening now\"; a fault no button reaches must not pulse like a live one",
  );
});

test("the vocabulary is named, and the names are the ones in use", () => {
  const disclosure = read("components/disclosure.tsx");
  for (const token of ["SECTION_SURFACE", "SUMMARY_BASE", "SUMMARY_ROW", "SUMMARY_LINK", "startsOpen"]) {
    assert.ok(disclosure.includes(`export const ${token}`) || disclosure.includes(`export function ${token}`),
      `${token} must be a named export of the shared module, not a per-component convention`);
  }
  // The three families must be built from one base, or they will drift apart
  // exactly the way the two copies of DISCLOSURE_SUMMARY_CLASS did.
  assert.match(disclosure, /export const SUMMARY_ROW = `\$\{SUMMARY_BASE\}/);
  assert.match(disclosure, /export const SUMMARY_LINK = `\$\{SUMMARY_BASE\}/);
});

test("a disclosure does not re-spell a family it could name", () => {
  // The specific leak: `cursor-pointer list-none` plus the focus ring is what
  // makes a <summary> behave like a control. Spelling it out is how seven
  // paddings happened, and how a control stopped being reachable by keyboard
  // in one of them.
  const families = /\b(min-h-11 cursor-pointer items-center|cursor-pointer list-none items-center)\b/;
  const offenders = ALL
    .filter((file) => file !== "components/disclosure.tsx")
    .flatMap((file) => codeLinesOf(file)
      .filter((line) => /<summary/.test(line) && families.test(line))
      .map((line) => `${file}: ${line.trim().slice(0, 70)}`));
  assert.deepEqual(
    offenders,
    [],
    "a <summary> is re-implementing a disclosure family. Use SUMMARY_ROW, SUMMARY_LINK, or DisclosureSection — "
    + "three named shapes instead of seven paddings, so the same accordion feels like one control everywhere",
  );
});

/**
 * A hand-written `<summary>` must still carry what `SUMMARY_BASE` carries.
 *
 * The guard above catches a summary that re-spells a NAMED family. It says
 * nothing about one that invents its own classes — and that is the violation
 * actually sitting in the tree: `scopes-list.tsx` writes
 * `cursor-pointer list-none space-y-1`, which matches neither family, so the
 * guard passes while the control has no `focus-visible:outline` and no
 * `marker:hidden`. Keyboard focus is invisible on it (WCAG 2.4.7).
 *
 * A mutation that rewrote the line INTO the guard's literal spelling failed it,
 * while the file as it stands passed. So the rule is the property: a `<summary>`
 * carrying its own className must include the tokens that make it a disclosure,
 * which is what SUMMARY_BASE is for.
 */


test("no local copy of a shared constant hides under a shared name", () => {
  // The most expensive kind of duplication: a constant whose NAME says shared,
  // duplicated, with different contents. Nothing in review catches that.
  const shared = /\b(SECTION_SURFACE|SUMMARY_ROW|SUMMARY_LINK|SUMMARY_BASE|TEXT_STATE|TEXT_SECTION|TEXT_BODY|TEXT_META)\b/;
  const offenders = ALL
    .filter((file) => !file.includes("disclosure") && !file.includes("design-tokens"))
    .flatMap((file) => codeLinesOf(file)
      .filter((line) => new RegExp(`^(const|let)\\s+${shared.source}`).test(line.trim()))
      .map((line) => `${file}: ${line.trim().slice(0, 70)}`));
  assert.deepEqual(offenders, [], "a shared name is being redefined locally — import it instead");
});

test("a type size is on the scale, or listed as a deliberate exception", () => {
  // Named Tailwind steps are on the scale by definition; this is about the
  // arbitrary values, which are the ones that accumulate without anyone
  // deciding them.
  //
  // The pattern allows a decimal, because the first version did not and a tab
  // label nudged from 13px to 12.5px "to fit" sailed straight through it. A
  // gate that only catches round numbers is not a gate.
  const SIZE = /text-\[\d+(?:\.\d+)?px\]/g;
  const named = new Set(["text-xs", "text-sm", "text-base", "text-lg", "text-xl"]);
  const allowed = new Set([...Object.keys(TYPE_EXCEPTIONS), ...sizesBehindTheScale(), ...named]);
  const offenders = ALL.flatMap((file) => codeLinesOf(file)
    .filter((line) => /text-\[\d/.test(line))
    .flatMap((line) => {
      const sizes = line.match(SIZE) ?? [];
      return sizes.filter((size) => !allowed.has(size)).map((size) => `${file}: ${size}`);
    }));
  assert.deepEqual(
    offenders,
    [],
    "a type size outside the scale. Use one of the named steps, or add the size to TYPE_EXCEPTIONS with the reason "
    + "it earns its place — a scale is only real if its exceptions are listed",
  );
});

/**
 * The literal sizes the four named steps are made of, read from the tokens
 * themselves rather than copied here — so a scale that changes size cannot
 * leave this test blessing the old one.
 *
 * This is deliberately a GROWTH gate, not a migration gate. `text-[11px]`
 * appears in 102 places, all of it the same size doing the same job; rewriting
 * 124 files in the same commit as a disclosure fix would bury the change under
 * noise, and a rule nobody can adopt in one sitting is a rule nobody adopts.
 * So the size is allowed, the SCALE names it, and a size that was not already
 * here cannot join. The 102 sites are owed a migration and are now counted
 * rather than invisible — which is the only honest status for a debt this size.
 */
function sizesBehindTheScale() {
  return TYPE_SCALE.flatMap((step) => step.match(/text-\[\d+px\]/g) ?? []);
}

test("every step of the scale names a size, and every exception says why", () => {
  // No count assertion. Asserting "exactly four" would be me inventing a
  // number and then defending it — the tab bar's 13px was already a real fifth
  // role that nobody had written down, and the fix for that is to name it, not
  // to force it back onto a step that does not fit. The rule is that each step
  // declares its size and each exception declares its reason.
  for (const step of TYPE_SCALE) {
    assert.ok(
      /text-(\[?\d+px|xs|sm|base|lg|xl)/.test(step),
      `each step names its size explicitly, so the literal is readable without opening this file: ${step}`,
    );
  }
  for (const [size, reason] of Object.entries(TYPE_EXCEPTIONS)) {
    assert.ok(reason.length > 20, `${size} must say what earns it an exception, not just that it has one`);
  }
  // The sizes behind the scale must be distinct, or two steps are the same step
  // under two names — the DISCLOSURE_SUMMARY_CLASS failure, in the type scale.
  const sizes = TYPE_SCALE.map((step) => step.match(/text-(\[?\d+px|xs|sm|base|lg|xl)/)?.[1]);
  assert.equal(new Set(sizes).size, sizes.length, `two scale steps share a size: ${sizes.join(", ")}`);
});

/**
 * The size the scale RENDERS, not the name it goes by.
 *
 * A card asked for larger section labels. The first two attempts "fixed" it by
 * re-spelling the constant and then by importing the constant — and both times
 * the suite went green, because nothing here asserted a size. `TEXT_SECTION` is
 * the token, and a token test that reads its sizes back out of the token
 * blesses whatever the token says, including the value it was written to fix.
 *
 * So these assert the rendered value and the ORDER it must respect. Reverting
 * `TEXT_SECTION` to 11px fails here — which is the point: the fix for a
 * complaint about a size has to be witnessed by something that knows the size.
 */
const renderedSize = (step) => {
  // Keyed by the CAPTURE (`xs`, `sm`, ...), which is what the regex group yields.
  const named = { xs: 12, sm: 14, base: 16, lg: 18, xl: 20 };
  const literal = step.match(/text-\[(\d+(?:\.\d+)?)px\]/);
  if (literal) return Number(literal[1]);
  // The named steps, matched with their `text-` prefix so a class list like
  // "text-xs text-muted-foreground" resolves instead of reading undefined.
  const tailwind = step.match(/\btext-(xs|sm|base|lg|xl)\b/);
  return tailwind ? named[tailwind[1]] : null;
};

test("a section label is not smaller than the metadata under it", () => {
  const section = renderedSize(TEXT_SECTION);
  const meta = renderedSize(TEXT_META);
  assert.ok(section !== null && meta !== null, "both sizes are readable");
  assert.ok(
    section >= meta,
    `a section heading must not be smaller than the metadata beneath it: TEXT_SECTION renders `
    + `${section}px against TEXT_META at ${meta}px. 11px was exactly this bug — the scale read backwards`,
  );
});

test("TEXT_SECTION renders at least 12px", () => {
  // The specific receipt for the complaint: the label is now big enough. Named
  // in the assertion so a reader knows what "big enough" was decided to be.
  assert.ok(
    renderedSize(TEXT_SECTION) >= 12,
    `section labels render ${renderedSize(TEXT_SECTION)}px; the card that asked for this named 11px `
    + "as too small, so anything under 12px is the unreverted defect",
  );
});

test("the legacy 11px size is a recorded exception, never a step", () => {
  // It stays usable by the ~100 sites already on it, but it must not be a STEP:
  // a step is a size the scale offers on purpose, and 11px as a section label
  // is the defect. This is the distinction the exception mechanism exists for.
  assert.ok(
    !TYPE_SCALE.some((step) => renderedSize(step) === 11),
    "11px is not a step of the scale",
  );
  assert.ok(
    "text-[11px]" in TYPE_EXCEPTIONS,
    "11px remains available as a recorded exception rather than vanishing, so the existing sites "
    + "stay legal while no new one may use it",
  );
});

/**
 * A migrated site keeps its migration.
 *
 * The chip and the stage badge were moved off `text-[11px]` onto the smallest
 * step still on the scale. Nothing asserted it: the token tests read sizes out
 * of the token, so reverting either site to 11px left every guard green. A
 * migration that no test can see is a migration that does not happen.
 *
 * So the sites are named here, with the rule that decides them — a stage marker
 * is not smaller than the prose describing it. `min-h-8` stays on the chip
 * deliberately: that is a touch-target decision, recorded in-file, and not this
 * guard's business.
 */

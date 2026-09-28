import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { TYPE_EXCEPTIONS, TYPE_SCALE } from "../lib/design-tokens.ts";

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
  return read(relative)
    .split("\n")
    .filter((line) => {
      const trimmed = line.trimStart();
      return !trimmed.startsWith("//") && !trimmed.startsWith("*") && !trimmed.startsWith("/*");
    });
}

const ALL = componentFiles().map((file) => file.replace(`${repoRoot}/`, ""));

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

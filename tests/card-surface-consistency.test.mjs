import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Two rules about the open card's surfaces, from the UX critique's consistency
 * and cognitive-load dimensions.
 *
 * ONE SHAPE. The card drew its sections eight different ways — `border p-3`,
 * `border p-4`, `border bg-background/60`, `border bg-muted/20` — each written
 * into whichever component needed it. Eight siblings that do not match do not
 * read as eight sections of one thing; they read as eight unrelated panels, and
 * the reader has to work out which ones matter from the decoration instead of
 * from the content. This is the surface half of a type scale: one shape, and
 * everything that makes a section differ is its TONE — a colour the reader
 * already learned from the hero — never a different border.
 *
 * CLOSED UNLESS EARNED. Progressive disclosure only works when the default is
 * closed and the reader earns the opening. Two exemptions, and only two: a
 * section holding something happening right now, and one the reader is blocked
 * on. The files the request named, the maps this workflow defines, the gaps a
 * past run recorded — all settled before the reader arrived, all of which used
 * to open unconditionally and push the page down before anyone asked.
 *
 * A third rule, cheap to state and easy to break: a section is a
 * `DisclosureSection`. The workflow map hand-rolled its own `<details>` with its
 * own chevron and background, which is the same pattern implemented twice and
 * therefore correct only until one of them changes.
 */
const repoRoot = join(fileURLToPath(import.meta.url), "..", "..");
const read = (relative) => readFileSync(join(repoRoot, relative), "utf8");

/**
 * Source with comments stripped. A comment that names the shape it just removed
 * — "not a hand-rolled <details>" — is documentation, and a test that cannot tell
 * documentation from code is a test people learn to work around.
 */
function codeLinesOf(relative) {
  return read(relative)
    .split("\n")
    .filter((line) => {
      const trimmed = line.trimStart();
      return !trimmed.startsWith("//") && !trimmed.startsWith("*") && !trimmed.startsWith("/*");
    });
}

/**
 * The files that draw a section on an open card. Nested content — a comment
 * bubble, a diff file, a run row — is not a section and is deliberately absent.
 */
const SECTION_FILES = [
  "components/detail/build-detail-hero.tsx",
  "components/detail/inbox-event-banner.tsx",
  "components/detail/build-progress.tsx",
  "components/detail/workflow-map.tsx",
  "components/detail/research-quality-section.tsx",
  "components/detail/explore-quality-section.tsx",
  "components/detail/explore-detail-content.tsx",
  "components/detail/research-detail-content.tsx",
  "components/worker-history/worker-history.tsx",
];

test("every section surface comes from the one token", () => {
  const token = read("components/disclosure.tsx");
  assert.match(
    token,
    /export const SECTION_SURFACE = "rounded-lg border bg-muted\/20"/,
    "the token must exist, and must be a single named surface rather than a convention",
  );
  for (const file of SECTION_FILES) {
    const source = read(file);
    // Every literal that draws a section's own border. A line that composes
    // SECTION_SURFACE is allowed to add padding or a tone; a line that spells
    // out `rounded-lg border` again is a second surface.
    const offenders = codeLinesOf(file)
      .filter((line) => /rounded-lg border/.test(line) && !line.includes("SECTION_SURFACE"));
    assert.deepEqual(offenders, [], `${file} draws its own section surface instead of SECTION_SURFACE`);
  }
});

test("a SECTION is the shared disclosure, not a second implementation of it", () => {
  // The workflow map had its own <details>, its own summary markup and its own
  // background — the same pattern written twice, correct only until one changed.
  //
  // The test is for a hand-rolled <details> that DRAWS A SURFACE, because that
  // is what makes a second section. A <details> nested inside a section is the
  // same pattern applied one level down — a scope's acceptance criteria, one
  // file in a diff, the worker's own history — and those carry no surface of
  // their own: they are content inside a section, which is progressive
  // disclosure working rather than a competing container. Banning every
  // <details> would ban the thing this file argues for.
  for (const file of SECTION_FILES) {
    const offenders = codeLinesOf(file)
      .filter((line) => /<details/.test(line) && /rounded-lg border/.test(line));
    assert.deepEqual(
      offenders,
      [],
      `${file} hand-rolls a section container. Use DisclosureSection, which carries the shared surface, the `
      + "chevron and the open state. A nested disclosure with no surface of its own is fine",
    );
  }
  assert.ok(
    read("components/detail/workflow-map.tsx").includes("<DisclosureSection"),
    "the workflow map must use the shared disclosure",
  );
});

/**
 * Sections that hold something live, or that the reader is blocked on, are
 * allowed to start open. Everything else starts closed.
 */
const EARNED = [
  { file: "components/detail/preview-section.tsx", live: "startsOpen({ live: running })" },
  { file: "components/detail/build-detail-progress.tsx", live: "live: hero?.kind === \"working\"" },
  { file: "components/detail/build-detail-content.tsx", live: "blocking: hero?.kind === \"decision\"" },
];

/** Settled before the reader arrived. History does not get the first screen. */
const UNEARNED = [
  "components/detail/input-files.tsx",
  "components/detail/workflow-map.tsx",
  "components/detail/research-quality-section.tsx",
  "components/detail/explore-quality-section.tsx",
];

test("a section starts open only when it is live or blocking", () => {
  for (const { file, live } of EARNED) {
    assert.ok(read(file).includes(live), `${file} must state why it opens: ${live}`);
  }
  for (const file of UNEARNED) {
    const source = read(file);
    const unconditional = source.match(/defaultOpen(\s|)(?!=\{)/g) ?? [];
    assert.deepEqual(
      unconditional,
      [],
      `${file} opens unconditionally. Sections hold history here — a file named in the request, a map of the `
      + "workflow, a past run's gaps — and history does not get the reader's first screen. Put the count in the "
      + "hint so closing costs the number and not the list",
    );
  }
});

test("the rule for opening is one named function, not a condition per component", () => {
  const token = read("components/disclosure.tsx");
  assert.match(
    token,
    /export function startsOpen\(\{ live = false, blocking = false \}/,
    "the two exemptions must be named once, so 'why is this open' has one answer",
  );
  assert.match(token, /return live \|\| blocking;/, "and the rule must be exactly those two, not a third");
});

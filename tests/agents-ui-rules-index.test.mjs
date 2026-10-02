import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * AGENTS.md's UI-vocabulary table must not be able to become a lie.
 *
 * A `DESIGN.md` was written here as the index of design rules, and it was
 * deleted three commits later for failing its own rule. The reasoning is worth
 * keeping, because it is the general failure and not this one file:
 *
 *  - Nothing loaded it. `AGENTS.md` is what every session reads; a separate
 *    design document is a document that gets missed, which is the same failure
 *    as a prose style guide, restated.
 *  - Most of it was duplicated. Three of its five distinctive claims were
 *    already in the docstrings of the tests that enforce them, so it was a
 *    second copy that could drift from the first.
 *  - It could go stale silently. It named test files, and renaming a test left
 *    the document pointing at nothing with no failure anywhere.
 *
 * That last one is the one that could have been fixed with a test, and the fix
 * belongs here rather than in a document: the rules moved to AGENTS.md, where
 * they are actually read, and this file makes the table there enforceable. A
 * rule list that no test checks is the thing being complained about.
 *
 * The check is deliberately narrow — the table must name only tests that exist,
 * and every test that enforces a UI rule must be in the table. It does not try
 * to validate prose, because prose about intent is not falsifiable and a test
 * that pretended to check it would be theatre.
 */
const repoRoot = join(fileURLToPath(import.meta.url), "..", "..");
const agents = readFileSync(join(repoRoot, "AGENTS.md"), "utf8");

/** The rules table, as `| rule | test |` rows. */
function declaredRows() {
  const section = agents.slice(agents.indexOf("### UI vocabulary"));
  return section
    .split("\n")
    .filter((line) => line.trim().startsWith("|") && !/^\|\s*-/.test(line.trim()) && !/Rule\s*\|/.test(line))
    .map((line) => line.split("|").slice(1, -1).map((cell) => cell.trim()))
    .filter((cells) => cells.length === 2);
}

const testFiles = readdirSync(join(repoRoot, "tests")).filter((file) => file.endsWith(".test.mjs"));
const testNames = new Set(testFiles.map((file) => file.replace(/\.test\.mjs$/, "")));

test("the UI rules table exists, in the file every session reads", () => {
  assert.ok(agents.includes("### UI vocabulary"), "the rules belong in AGENTS.md, which is the instruction file sessions load");
  assert.ok(
    !existsSync(join(repoRoot, "DESIGN.md")),
    "a separate design document is a document that gets missed — and it failed its own rule that an "
    + "unenforced rule does not belong in prose",
  );
});

test("every rule names a test that exists", () => {
  const rows = declaredRows();
  assert.ok(rows.length >= 5, `the table should carry the rules, found ${rows.length} rows`);
  for (const [rule, test] of rows) {
    const named = test.replace(/`/g, "").trim();
    assert.ok(
      testNames.has(named),
      `the rule "${rule.slice(0, 60)}…" names ${named}, which is not a test in tests/. A rule pointing at a test `
      + "that no longer exists is the exact failure this file exists to prevent — update the row or restore the test",
    );
    assert.ok(
      existsSync(join(repoRoot, "tests", `${named}.test.mjs`)),
      `${named}.test.mjs is missing`,
    );
  }
});

test("every UI-vocabulary test is in the table", () => {
  // The other direction. A test that enforces a design rule but is absent from
  // the index is a rule nobody was told about, which is how `min-h-11` sat
  // unenforced for as long as it did.
  const cardTests = [...testNames].filter((name) => name.startsWith("card-") && /design|surface|hierarchy/.test(name));
  const declared = new Set(declaredRows().map(([, test]) => test.replace(/`/g, "").trim()));
  const missing = cardTests.filter((name) => !declared.has(name));
  assert.deepEqual(missing, [], "these tests enforce a UI rule but the table does not say so");
});

test("the unenforced rules are named as debt rather than quietly listed", () => {
  // The honest bit: this section is least able to keep `min-h-11` on its own,
  // and saying so is what stops the sentence from reading like an enforcement.
  const section = agents.slice(agents.indexOf("### UI vocabulary"));
  assert.match(
    section,
    /Known debt/,
    "a rule stated without a test must be declared as debt in the same breath, or it reads as enforced",
  );
  // The debt carries a COUNT, and the count is measured here rather than
  // trusted. It used to be a literal — first ~101, then 109 — and a literal in
  // a document about how stale counts mislead is the drift it warns against,
  // written by the same hand. Asserting the stated number against a fresh
  // census makes the sentence true or red, never merely old.
  const stated = section.match(/text-\[11px\]` still\s+appears in (\d+) places/);
  assert.ok(stated, "the type-size debt names a measured count, not 'some places'");
  const measured = countOccurrences(
    [join(repoRoot, "components"), join(repoRoot, "lib")],
    /text-\[11px\]/g,
  );
  assert.equal(
    Number(stated[1]),
    measured,
    "the count in AGENTS.md is a measurement of this checkout, so it cannot drift unnoticed",
  );
  const statedButtons = section.match(/and (\d+) raw `<button>` elements/);
  assert.ok(statedButtons, "the raw-button debt names a measured count too");
  assert.equal(
    Number(statedButtons[1]),
    countOccurrences([join(repoRoot, "components")], /<button/g, [".tsx"]),
    "the raw-button count is measured against components/**/*.tsx",
  );
});

/** How many times `pattern` occurs across the given roots. Recursive and
 * extension-filtered so the count is the one a reader would get from grep. */
function countOccurrences(roots, pattern, extensions = [".ts", ".tsx", ".mjs"]) {
  let total = 0;
  for (const root of roots) {
    for (const entry of readdirSync(root, { withFileTypes: true, recursive: true })) {
      if (!entry.isFile()) continue;
      if (!extensions.some((extension) => entry.name.endsWith(extension))) continue;
      const text = readFileSync(join(entry.parentPath, entry.name), "utf8");
      total += text.match(pattern)?.length ?? 0;
    }
  }
  return total;
}

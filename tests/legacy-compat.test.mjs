/**
 * The legacy ledger is only worth reading if it cannot lie, and nothing checked it.
 *
 * `docs/legacy-compat.md` opened with a promise it could not keep: "Each entry
 * pins literal code anchors below. `tests/fresh-install.test.mjs` parses this
 * file and fails when an anchor disappears without a ledger update." No test
 * parsed that file — `fresh-install.test.mjs` never named it — so twelve of the
 * sixteen entries pointed at text that no longer exists anywhere: anchors for a
 * module that was split (`server/decision-api.ts` → `decision-store.ts`), for
 * files renamed (`server/github-issues.ts` → `github-migrations.ts`), for
 * functions renamed (`insertDefaultPreset` → `ensureDefaultPreset`), for columns
 * whose ALTER was deleted on purpose, and for a `bb.storage.migrate(db, [` call
 * that became `bb.storage.migrate(db, BASE_MIGRATION_STATEMENTS)`. A ledger that
 * is 75% stale does not merely fail to inform; it teaches the next reader that
 * its entries are decorative, which is the exact drift a ledger exists to stop.
 *
 * So this is the parser the ledger claimed to have. It reads the file as data —
 * entry per `## L-NN title`, one `- file:`, one or more `- anchor:` — and asserts
 * every anchor is a literal substring of the named file. That is the cheapest
 * useful check: it catches a rename, a move, and a deletion, which are the three
 * ways an entry goes stale, and it cannot pass while pointing at nothing.
 *
 * What it deliberately does NOT do: judge whether an entry is *correct*, or
 * require the anchored code to be a migration. A tombstone entry (L-10, whose
 * backfill was deleted) anchors the seed that replaced it, and this test can only
 * confirm the anchor is real. Reading the ledger remains a human job; keeping it
 * from rotting is this one.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const ROOT = new URL("../", import.meta.url);
const LEDGER = new URL("docs/legacy-compat.md", ROOT);

/** One entry per `## L-NN title` section, with its file and literal anchors. */
function parseLedger(markdown) {
  return markdown
    .split(/^## /m)
    .slice(1)
    .map((section) => {
      const [title, ...body] = section.split("\n");
      const text = body.join("\n");
      return {
        title: title.trim(),
        file: text.match(/^- file: `([^`]+)`/m)?.[1],
        anchors: [...text.matchAll(/^- anchor: `([^`]+)`/gm)].map((match) => match[1]),
      };
    });
}

const ENTRIES = parseLedger(readFileSync(LEDGER, "utf8"));

test("the ledger parses into well-formed entries", () => {
  assert.ok(ENTRIES.length >= 16, `the ledger still has its entries (found ${ENTRIES.length})`);
  for (const entry of ENTRIES) {
    assert.match(entry.title, /^L-\d+ /, `entry "${entry.title}" is titled L-NN`);
    assert.notEqual(entry.file, undefined, `${entry.title} names a file`);
    assert.ok(entry.anchors.length > 0, `${entry.title} pins at least one anchor`);
  }
  const titles = ENTRIES.map((entry) => entry.title.split(" ")[0]);
  assert.equal(new Set(titles).size, titles.length, "no entry id is used twice");
});

test("every anchor in the ledger exists in the file it names", () => {
  for (const entry of ENTRIES) {
    const source = readFileSync(new URL(entry.file, ROOT), "utf8");
    for (const anchor of entry.anchors) {
      assert.ok(
        source.includes(anchor),
        `${entry.title}: \`${entry.file}\` no longer contains ${JSON.stringify(anchor)}. `
        + "Either the code moved and the anchor belongs next to it now, or the code was deleted "
        + "and the entry goes with it in the same commit. Update docs/legacy-compat.md rather "
        + "than leaving an anchor that points at nothing.",
      );
    }
  }
});

test("the ledger's own claims about which test guards it are true", () => {
  const markdown = readFileSync(LEDGER, "utf8");
  const claimed = markdown.match(/`(tests\/[a-z0-9.-]+\.test\.mjs)`\s*\n?\s*parses this file/);
  assert.notEqual(claimed, null, "the ledger names the test that parses it");
  // The claim is only honest if the file it names is the file doing the parsing.
  assert.equal(
    claimed[1],
    "tests/legacy-compat.test.mjs",
    "the ledger must name the test that actually parses it",
  );
  // And that test has to be wired, or the promise is true in prose only.
  const manifest = JSON.parse(readFileSync(new URL("package.json", ROOT), "utf8"));
  const wired = Object.values(manifest.scripts).some((script) =>
    script.includes("legacy-compat.test.mjs"),
  );
  assert.equal(wired, true, "tests/legacy-compat.test.mjs runs from a package.json script");
});

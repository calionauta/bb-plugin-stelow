import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync } from "node:fs";
import { relative } from "node:path";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * A document nothing links is a document nobody reads.
 *
 * AGENTS.md states the rule for the feature inventory — "an unlinked doc does
 * not exist either" — and states the root contract too: the top level carries
 * the instruction file and the inventories, not loose plans. Both were true in
 * prose and false on disk: a 236-line plan sat at the root, and two docs had no
 * entry in the index. A rule with no test is a preference, so this is the test.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const rootMarkdown = new Set(["README.md", "CHANGELOG.md", "FEATURES.md", "AGENTS.md"]);

function globToRegExp(pattern) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}

/** Every markdown path an entry point names, by name or by declared glob. */
function indexedMarkdown() {
  const sources = ["docs/README.md", "README.md", "FEATURES.md"]
    .map((file) => readFileSync(join(root, file), "utf8"))
    .join("\n");
  const entries = [...sources.matchAll(/`([^`]+\.md)`/g)].map((match) => match[1]);
  return {
    named: new Set(entries.filter((entry) => !entry.includes("*"))),
    globs: entries.filter((entry) => entry.includes("*")).map(globToRegExp),
  };
}

/**
 * Every markdown under `docs/`, relative to it, minus the directories that are
 * deliberately unindexed.
 *
 * This used to walk `docs/` non-recursively, which left every subdirectory
 * unguarded: sixteen audit records lived in `docs/audits/` with nothing failing
 * if the index dropped them. A real card reported that as a `debt` gap
 * (`tests/docs-index`, medium) and it was right - the rule "an unlinked doc does
 * not exist" applied to exactly one level.
 *
 * `runs/` stays out on purpose: it is per-card execution evidence, never linked
 * from a user document, and indexing hundreds of run files would make the index
 * unusable. The exception is declared here, with its reason, rather than left to
 * a shallow walk to hide.
 */
const UNINDEXED_DIRS = ["runs/"];

function markdownUnder(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      const rel = `${relative(join(root, "docs"), path)}/`;
      if (UNINDEXED_DIRS.includes(rel)) continue;
      found.push(...markdownUnder(path));
    } else if (entry.name.endsWith(".md")) {
      found.push(relative(join(root, "docs"), path));
    }
  }
  return found;
}

test("every docs file is reachable from an index, by name or by a declared glob", () => {
  const { named, globs } = indexedMarkdown();
  const files = markdownUnder(join(root, "docs")).filter((file) => file !== "README.md");
  const orphans = files.filter((file) =>
    !named.has(file) && !named.has(`docs/${file}`) && !globs.some((glob) => glob.test(file)));
  assert.deepEqual(
    orphans,
    [],
    "these docs are linked from nowhere — add them to docs/README.md, or delete them",
  );
});

test("the repository root carries only the contract markdown", () => {
  const strays = readdirSync(root)
    .filter((file) => file.endsWith(".md") && !rootMarkdown.has(file));
  assert.deepEqual(
    strays,
    [],
    "a plan or note at the repo root has no home; maintainer material belongs in docs/",
  );
});

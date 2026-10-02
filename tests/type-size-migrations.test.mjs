/**
 * A migrated site keeps its migration.
 *
 * The stage chip and the stage badge were moved off `text-[11px]` onto the
 * smallest step still on the scale, and nothing asserted it: the token tests
 * read sizes out of the token, so reverting either site left every guard green.
 * A migration no test can see is a migration that does not happen.
 *
 * Split from `disclosure-affordance.test.mjs` by the function budget — the first
 * version of this rule was one 63-line callback.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { codeLinesOf as stripComments } from "./helpers/source-code.mjs";

const repoRoot = join(fileURLToPath(import.meta.url), "..", "..");
const read = (relative) => readFileSync(join(repoRoot, relative), "utf8");

const codeLinesOf = (relative) => stripComments(read(relative));

const MIGRATED_SITES = [
  { file: "components/detail/stage-section.tsx", const: "STAGE_INDEX_BADGE", what: "the stage number" },
  { file: "components/detail/stage-timeline.tsx", const: "stageChip", what: "the stage chip" },
];

test("every site migrated off the legacy 11px stays migrated", () => {
  const regressions = MIGRATED_SITES.flatMap(({ file, const: name, what }) => {
    const source = readFileSync(join(repoRoot, file), "utf8");
    // Read the declaration's CODE, not the file: strip comments first, because
    // both declarations are documented with the size they REMOVED, and a reader
    // that sees the prose reports a correct migration as a regression. Two
    // earlier readers did exactly that — one swallowed the comment, one matched
    // a `const` while the site was a `function`.
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/\/\/[^\n]*/g, " ");
    const lines = code.split("\n");
    const start = lines.findIndex((line) => new RegExp(`\\b(const|function) ${name}\\b`).test(line));
    if (start < 0) return [`${file}: ${name} is gone — the migration cannot be checked`];
    // Walk forward to the line that closes the declaration: the first one whose
    // brace depth has returned to zero.
    let depth = 0;
    let seen = false;
    const body = [];
    for (let i = start; i < lines.length && i - start < 40; i++) {
      const line = lines[i];
      body.push(line);
      for (const ch of line) {
        if (ch === "{" || ch === "[" || ch === "(") depth += 1;
        if (ch === "}" || ch === "]" || ch === ")") depth -= 1;
      }
      if (depth > 0) seen = true;
      if (seen && depth <= 0) break;
    }
    const declaration = body.join("\n");
    return /text-\[11px\]/.test(declaration)
      ? [`${file}: ${what} (${name}) is back on text-[11px], the size this migration removed`]
      : [];
  });
  assert.deepEqual(
    regressions,
    [],
    "a migrated site regressed to the grandfathered size — 11px is a recorded exception now, not a step, "
    + "and a stage marker may not be smaller than the label beside it",
  );
});

test("no hardcoded 11px survives in the components this card rewrote", () => {
  // The recorded exception exists for the ~100 sites that predate the decision.
  // The files this card owns should not be among them.
  const owned = [
    "components/detail/stage-section.tsx",
    "components/detail/stage-timeline.tsx",
    "components/detail/scope-relations.tsx",
  ];
  const leftovers = owned.flatMap((file) =>
    codeLinesOf(file)
      .filter((line) => /text-\[11px\]/.test(line) && !line.trim().startsWith("*") && !line.trim().startsWith("//"))
      .map((line) => `${file}: ${line.trim().slice(0, 60)}`));
  assert.deepEqual(
    leftovers,
    [],
    "these files were rewritten by this card and carry no 11px of their own; a comment mentioning the "
    + "size is fine, a className using it is not",
  );
});

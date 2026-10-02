import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

/**
 * One owner per vocabulary, across every axis.
 *
 * A second declaration of a stage name or a status name is how two surfaces start
 * disagreeing, and the symptom is never a bug report — it is a reader concluding
 * that "Interface gate" and `int-gate` are two different stages, or that a card
 * is "Done" on the board and "in-progress" in a search result. Saying "there is
 * one source of truth" in prose is worth nothing; this is the claim.
 *
 * It lives in one file covering all four axes rather than beside the first axis,
 * because the rule is one rule. Splitting it per-axis is the fragmentation it
 * exists to prevent, and a fourth axis added without a check is exactly how the
 * drift starts again.
 *
 * What this cannot do is judge whether a name is GOOD. It can only insist there
 * is one place to change it. Wording is a product call.
 */

const root = new URL("..", import.meta.url).pathname;

/**
 * The one file allowed to declare each map, and the axis it answers for.
 *
 * The permission is per-file rather than global so that moving a label into some
 * unrelated module still fails — "declared in exactly one place" is the property,
 * not "declared somewhere".
 */
const OWNERS = {
  STAGE_LABELS: "lib/workflow-catalog.mjs",
  BUILD_BOARD_COLUMN_LABELS: "lib/workflow-vocabulary.mjs",
  PHASE_LABELS: "lib/workflow-catalog.mjs",
  TRACKABLE_STATUS_LABELS: "lib/trackables.mjs",
  RUN_STATUS_LABELS: "lib/execution-run-ledger.mjs",
  CARD_STATUS_LABELS: "lib/card-status.mjs",
};

const ownedFiles = () => execFileSync(
  "git",
  ["ls-files", "*.ts", "*.tsx", "*.mjs", "*.mts"],
  { cwd: root },
).toString().split("\n").filter(Boolean);

test("no vocabulary is declared anywhere but its owner", () => {
  // A topology constraint, not a copy check: it names which file OWNS each map,
  // so a second owner fails loudly instead of quietly diverging. Reading it, the
  // failure names the offending file AND the map it re-declared.
  const declared = /^\s*(?:export\s+)?const\s+([A-Z_]*(?:LABELS|MAP))\s*(?::[^=]+)?=\s*\{/gm;
  const owners = new Set(Object.values(OWNERS));
  const offences = [];
  for (const file of ownedFiles()) {
    if (owners.has(file)) continue;
    for (const match of readFileSync(join(root, file), "utf8").matchAll(declared)) {
      if (!(match[1] in OWNERS)) continue;
      offences.push(`${file} re-declares ${match[1]} (owner: ${OWNERS[match[1]]})`);
    }
  }
  assert.deepEqual(offences, [], "each vocabulary has exactly one owner");
});

test("every owner actually declares its map", () => {
  // The inverse direction, because a permission with no declaration behind it is
  // a hole: delete `TRACKABLE_STATUS_LABELS` from lib/trackables.mjs and the
  // test above would pass while the vocabulary stopped existing.
  for (const [name, file] of Object.entries(OWNERS)) {
    if (file === "lib/workflow-catalog.mjs") continue; // re-exports, declares nothing
    const source = readFileSync(join(root, file), "utf8");
    assert.match(
      source,
      // `Object.freeze(` is allowed between `=` and `{` because every one of
      // these is frozen, and a rule that stopped matching once someone added the
      // freeze would be a rule that quietly stopped protecting anything.
      new RegExp(`const\\s+${name}\\s*(?::[^=]+)?=\\s*(?:Object\\.freeze\\()?\\{`),
      `${file} no longer declares ${name}`,
    );
  }
});

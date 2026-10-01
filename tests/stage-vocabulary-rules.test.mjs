import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { STAGE_LABELS, WORKFLOW_STAGES, stageLabel } from "../lib/workflow-vocabulary.mjs";

/**
 * The stage vocabulary, as a contract rather than a preference.
 *
 * `data/stelow-stage-catalog.json` is the one place a stage gets a name. That is
 * a claim, and a claim in a markdown file is worth nothing — so these tests are
 * the claim. Two rules, and both exist because the alternative was shipped:
 *
 * 1. **One owner.** No other file may declare a stage-to-name map. A second map
 *    is how two surfaces start disagreeing, and the symptom is not a bug report
 *    — it is a reader concluding that "Interface gate" and "int-gate" are two
 *    different stages.
 *
 * 2. **A name, not a variable.** Every stage's display label must differ from
 *    its stored id, and must be unique across the catalog. The first half is the
 *    complaint that started this: `int-gate`, `plan-gate` and `diff-gate` are
 *    database keys and CLI arguments, and printing one is printing a variable
 *    name at a person who has to decide something.
 *
 * Neither rule can tell you the label is GOOD. "Plan gate" satisfied both for
 * months — distinct, not the slug — and no test here would have objected. Wording
 * is a product decision; these two only make it impossible to ship a stage with
 * no name at all, or to give two stages the same one.
 */

const root = new URL("..", import.meta.url).pathname;

/** Files allowed to declare stage names: the catalog and the module that reads it. */
const CATALOG_OWNERS = [
  "data/stelow-stage-catalog.json",
  "lib/workflow-catalog.mjs",
  "lib/workflow-vocabulary.mjs",
];

test("the catalog gives every stage a name that is not its stored id", () => {
  for (const stage of WORKFLOW_STAGES) {
    assert.notEqual(
      stage.label,
      stage.id,
      `${stage.id} would be shown to readers as its own variable name — give it a name`,
    );
    assert.ok(stage.label.trim().length > 0, `${stage.id} has no label`);
  }
});

test("no two stages share a name", () => {
  // Two stages called "Review" is a card that cannot say which one it is at.
  const byLabel = new Map();
  for (const stage of WORKFLOW_STAGES) {
    const seen = byLabel.get(stage.label);
    assert.ok(!seen, `"${stage.label}" names both ${seen} and ${stage.id}`);
    byLabel.set(stage.label, stage.id);
  }
});

test("stageLabel reads the catalog rather than restating it", () => {
  for (const stage of WORKFLOW_STAGES) {
    assert.equal(stageLabel(stage.id), stage.label, `${stage.id} resolves to its catalog name`);
  }
  // The fallback is deliberate and load-bearing: a card on a stage this build
  // has never heard of must still be findable and still say where it is. It is
  // pinned so that "return null for an unknown stage" cannot look like tidying.
  assert.equal(stageLabel("stage_from_the_future"), "stage_from_the_future");
  assert.equal(stageLabel("research"), "Research");
  assert.equal(stageLabel("explore"), "Explore");
});

test("nothing outside the catalog declares a stage name", () => {
  // A topology constraint, not a copy check: it names which file OWNS the map,
  // so a second owner fails loudly instead of quietly diverging.
  const declared = /^\s*(?:export\s+)?const\s+(STAGE_LABELS|BUILD_BOARD_COLUMN_LABELS|PHASE_LABELS)\s*(?::[^=]+)?=\s*\{/gm;
  const owners = new Set();
  const offenders = [];
  const files = execFileSync("git", ["ls-files", "*.ts", "*.tsx", "*.mjs", "*.mts"], { cwd: root })
    .toString().split("\n").filter(Boolean);
  for (const file of files) {
    if (CATALOG_OWNERS.includes(file)) continue;
    const source = readFileSync(join(root, file), "utf8");
    for (const match of source.matchAll(declared)) {
      offenders.push(`${file} re-declares ${match[1]}`);
      owners.add(match[1]);
    }
  }
  assert.deepEqual(offenders, [], "the stage vocabulary has exactly one owner");
});

test("a label is a name a reader can read, not a variable", () => {
  // Cheap structural floor on wording. It cannot judge whether "Plan gate" was a
  // good choice, but it does refuse the two shapes that are never good: an
  // all-lowercase slug, and a Title-Cased identifier with hyphens or underscores
  // still in it (that is a stage id someone renamed in place).
  for (const stage of WORKFLOW_STAGES) {
    assert.match(
      stage.label,
      /^[A-Z]/,
      `${stage.id} label "${stage.label}" does not start like a name`,
    );
    assert.doesNotMatch(
      stage.label,
      /[-_]/,
      `${stage.id} label "${stage.label}" still looks like an identifier`,
    );
  }
});

test("a stage added without a label fails the suite, not the reader", () => {
  // The whole point: adding a stage is a normal thing to do, and forgetting the
  // name is the mistake. This asserts the contract above exists by checking the
  // catalog shape it depends on, so the guard cannot be satisfied by deleting it.
  assert.ok(Array.isArray(WORKFLOW_STAGES) && WORKFLOW_STAGES.length > 0);
  assert.equal(
    Object.keys(STAGE_LABELS).length,
    WORKFLOW_STAGES.length,
    "every stage id resolves to a label",
  );
});

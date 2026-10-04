import assert from "node:assert/strict";
import { recipeById } from "../lib/recipe-catalog.mjs";
import {
  checklistLines,
  collectSequentialReceipts,
  sequentialTaskPlan,
} from "../lib/sequential-receipts.mjs";

const planning = recipeById("planning-research");
const alternatives = recipeById("interface-alternatives");

const plan = sequentialTaskPlan(planning, {});
assert.equal(plan.width, 2, "planning-research plans width 2");
assert.deepEqual(
  plan.ordered.map((entry) => entry.taskId),
  ["planning-stack", "planning-testing", "planning-alignment"],
  "plan order follows the catalog",
);
assert.deepEqual(plan.skipped, [], "nothing skipped under default context");

const collapsed = sequentialTaskPlan(alternatives, { explorationCount: 1 });
assert.equal(collapsed.width, 0, "collapsed plan has zero width");
assert.ok(collapsed.skipped.length > 0, "collapsed tasks are reported as skipped");

const full = {
  "plans/stack-research.md": "# stack",
  "plans/testing-strategy.md": "# testing",
  "plans/planning-alignment.md": "# alignment",
};
const collected = collectSequentialReceipts({ recipe: planning, contents: full, context: {} });
assert.equal(collected.ok, true, "complete contents validate");
assert.equal(collected.width, 2, "receipts carry the width");
assert.ok(
  collected.receipts.every((receipt) => receipt.present && !receipt.skipped),
  "every receipt is present",
);

const empty = collectSequentialReceipts({ recipe: planning, contents: {}, context: {} });
assert.equal(empty.ok, false, "missing contents fail");
assert.deepEqual(
  empty.missing.sort(),
  ["plans/planning-alignment.md", "plans/stack-research.md", "plans/testing-strategy.md"].sort(),
  "missing paths are named",
);

const partial = collectSequentialReceipts({
  recipe: alternatives,
  contents: { "interfaces/alternatives.json": " " },
  context: { explorationCount: 1 },
});
assert.ok(
  partial.receipts.some((receipt) => receipt.skipped),
  "skipped tasks land as skipped receipts, never as missing",
);

assert.deepEqual(
  checklistLines(planning, {}),
  [
    "plans/stack-research.md [planning-stack]",
    "plans/testing-strategy.md [planning-testing]",
    "plans/planning-alignment.md [planning-alignment]",
  ],
  "checklist names every required output with its task",
);

console.log("sequential receipts test ok: plan, validation, and skipped receipts");

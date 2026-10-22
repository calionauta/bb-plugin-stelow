import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { recipeById } from "../lib/recipe-catalog.mjs";
import { RECIPE_CONDITIONS, recipeConditionHolds } from "../lib/recipe-conditions.mjs";
import { requiredOutputPaths } from "../lib/execution-artifacts.mjs";
import { isRecipeTaskActive } from "../lib/recipe-width.mjs";
import { renderInlineWorkflowScript } from "../server/bb-workflow-bridge.ts";

const root = join(import.meta.dirname, "..");
const schema = JSON.parse(readFileSync(join(root, "data/stelow-recipes.schema.json"), "utf8"));
const catalog = JSON.parse(readFileSync(join(root, "data/stelow-recipe-catalog.json"), "utf8"));

/**
 * The condition vocabulary has one owner and one implementation.
 *
 * Upstream declares the vocabulary (`recipes.schema.json` in the stelow repo,
 * synced here as `data/stelow-recipes.schema.json`); this host reads that
 * declaration and implements exactly it. The three implementations that used
 * to live here had already drifted: the route layer and the artifact layer
 * disagreed about `appetite_supports_fanout`, and the native renderer threw
 * on an unknown condition while the other two ran the task.
 *
 * The drift needed a condition nobody uses to stay invisible, so the live
 * catalog's two conditions hid it. These assertions are the gate.
 */

assert.ok(
  RECIPE_CONDITIONS.length > 0,
  "the synced recipe schema declares no condition vocabulary — the host is pinned to a stelow older than the declaration; sync first",
);
assert.deepEqual(
  RECIPE_CONDITIONS,
  schema.$defs?.condition?.enum ?? [],
  "the host reads the vocabulary from the synced schema, and that is what it declares",
);

for (const condition of RECIPE_CONDITIONS) {
  assert.doesNotThrow(
    () => recipeConditionHolds({ when: condition }, { explorationCount: 3, partitionSafe: true, uiScopePresent: true }, {}),
    `the host does not implement the declared condition "${condition}"`,
  );
}

assert.throws(
  () => recipeConditionHolds({ when: "not_a_condition" }, {}, {}),
  /Unknown recipe condition/,
  "an unimplemented condition is refused, not read as \"run it\"",
);

// Every condition a live recipe uses is declared upstream.
const used = new Set();
for (const recipe of catalog.recipes ?? []) {
  for (const task of recipe.tasks ?? []) used.add(task.when ?? "always");
}
const undeclared = [...used].filter((condition) => !RECIPE_CONDITIONS.includes(condition));
assert.deepEqual(undeclared, [], `the catalog uses conditions the schema does not declare: ${undeclared.join(", ")}`);

// The two layers that used to disagree now agree, because there is one
// evaluator. The case that separated them: an explicit exploration count
// wins over the legacy appetite.
const DISAGREEING = { appetite: "Lean", explorationCount: 3 };
assert.equal(
  isRecipeTaskActive({ when: "appetite_supports_fanout" }, DISAGREEING),
  true,
  "an explicit exploration count of 3 supports fan-out",
);
assert.deepEqual(
  requiredOutputPaths({ tasks: [{ id: "t", output: "o.json", when: "appetite_supports_fanout" }] }, DISAGREEING),
  ["o.json"],
  "the artifact layer agrees with the route layer about the same condition",
);
assert.deepEqual(
  requiredOutputPaths({ tasks: [{ id: "t", output: "o.json", when: "appetite_supports_fanout" }] }, { appetite: "Lean", explorationCount: 1 }),
  [],
  "a count of 1 does not support fan-out, in either layer",
);

// The native renderer embeds the evaluator's SOURCE, so the script it hands
// the host runs the same function rather than a transcription of it.
const rendered = renderInlineWorkflowScript(recipeById("verification"), { localRunId: "vocab-1" });
assert.ok(
  rendered.includes(recipeConditionHolds.toString()),
  "the rendered script carries the one evaluator's source, not a copy of it",
);
assert.ok(
  !rendered.includes("Unknown recipe condition: \" + task.when"),
  "the rendered script does not carry the old hand-written evaluator",
);

console.log(
  `recipe condition vocabulary ok: ${RECIPE_CONDITIONS.length} declared conditions, one evaluator, three layers agree`,
);

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BB_NATIVE_CAPABILITIES } from "../lib/bb-workflow-capabilities.mjs";
import { EXECUTION_CAPABILITIES, assertCapabilities } from "../lib/execution-adapter.mjs";
import { requiredOutputPaths, safeArtifactPath, validateExecutionArtifacts } from "../lib/execution-artifacts.mjs";
import { evaluateScopeBatchPilot, resolveExecutionRoute } from "../lib/execution-route.mjs";
import { renderInlineWorkflowScript } from "../server/bb-workflow-bridge.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = readJson("tests/fixtures/recipe-pilot-matrix.json");
const catalog = readJson("data/stelow-recipe-catalog.json");
const recipes = catalog.recipes ?? [];
const rows = new Map(manifest.recipes.map((row) => [row.id, row]));
const knownCapabilities = new Set(EXECUTION_CAPABILITIES);
const supportedConditions = new Set(["always", "appetite_supports_fanout", "partition_is_safe", "ui_scope_present"]);
const artifactContext = { appetite: "Complete", partitionSafe: true, uiScopePresent: true };

function readJson(path) {
  return JSON.parse(readFileSync(join(root, path), "utf8"));
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(join(root, path))).digest("hex");
}

function exactKeys(value, keys, label) {
  assert.ok(value && typeof value === "object" && !Array.isArray(value), `${label} is an object`);
  assert.deepEqual(Object.keys(value).sort(), [...keys].sort(), `${label} has the exact schema`);
}

function sortedUnique(values, label) {
  assert.ok(Array.isArray(values), `${label} is an array`);
  assert.deepEqual([...new Set(values)].sort(), values, `${label} is sorted and unique`);
  return values;
}

function expectedCapabilities(recipe) {
  return [...new Set([
    ...(recipe.required_capabilities ?? []),
    ...(recipe.tasks ?? []).flatMap((task) => task.requirements ?? []),
  ])].sort();
}

function assertTaskGraph(recipe) {
  const taskIds = new Set();
  const outputs = new Set();
  const graph = new Map();
  for (const task of recipe.tasks) {
    assert.match(task.id, /^[a-z][a-z0-9-]*$/, `${recipe.id}/${task.id} has a safe task id`);
    assert.equal(taskIds.has(task.id), false, `${recipe.id}/${task.id} task id is unique`);
    taskIds.add(task.id);
    assert.equal(safeArtifactPath(task.output), true, `${recipe.id}/${task.id} output is artifact-confined`);
    assert.equal(safeArtifactPath(task.output_schema), true, `${recipe.id}/${task.id} schema path is confined`);
    assert.equal(outputs.has(task.output), false, `${recipe.id}/${task.id} output is unique`);
    outputs.add(task.output);
    assert.equal(supportedConditions.has(task.when), true, `${recipe.id}/${task.id} uses a known condition`);
    assert.equal(task.output_schema_contract && typeof task.output_schema_contract === "object", true, `${recipe.id}/${task.id} has an output contract`);
    for (const capability of task.requirements ?? []) assert.equal(knownCapabilities.has(capability), true, `${recipe.id}/${task.id} uses known capability ${capability}`);
    graph.set(task.id, task.depends_on ?? []);
  }
  for (const [taskId, dependencies] of graph) {
    assert.equal(new Set(dependencies).size, dependencies.length, `${recipe.id}/${taskId} has no duplicate dependency`);
    for (const dependency of dependencies) assert.equal(taskIds.has(dependency), true, `${recipe.id}/${taskId} dependency exists: ${dependency}`);
  }
  const visiting = new Set();
  const visited = new Set();
  function visit(taskId) {
    assert.equal(visiting.has(taskId), false, `${recipe.id} dependency graph is acyclic at ${taskId}`);
    if (visited.has(taskId)) return;
    visiting.add(taskId);
    for (const dependency of graph.get(taskId)) visit(dependency);
    visiting.delete(taskId);
    visited.add(taskId);
  }
  for (const taskId of taskIds) visit(taskId);
}

function sample(schema) {
  if (schema.enum) return schema.enum[0];
  if (schema.type === "object") {
    return Object.fromEntries(Object.entries(schema.properties ?? {}).map(([key, child]) => [key, sample(child)]));
  }
  if (schema.type === "array") return Array.from({ length: Math.max(1, schema.minItems ?? 0) }, () => sample(schema.items));
  if (schema.type === "number") return schema.const ?? 0;
  if (schema.type === "string") return "pilot evidence";
  if (schema.type === "boolean") return true;
  assert.fail(`matrix cannot synthesize unsupported schema type: ${schema.type}`);
}

function validContents(recipe) {
  const scopeMap = {
    schemaVersion: 1,
    mapId: "map-pilot",
    status: "approved",
    shapeVersion: "v1",
    provenance: ["simulation:pilot"],
    approval: { receiptId: "approval-pilot", approvedBy: "simulation" },
    openDecisions: [],
    scopes: [{
      id: "scope-1",
      title: "Pilot scope",
      outcome: "Pilot outcome",
      capabilities: ["pilot"],
      inScope: ["pilot behavior"],
      outOfScope: [],
      dependsOn: [],
      status: "current",
    }],
  };
  const contrast = {
    schemaVersion: 1,
    receiptId: "contrast-pilot",
    route: "interface-refinement",
    briefStatus: "generation-ready",
    authority: "agent",
    disposition: "continue",
    shapeVersion: "v1",
    scopeMapVersion: "map-pilot",
    decisionQuestion: "Which pilot interface should be selected?",
    primaryDimension: "focus",
    fixedConstraints: [{ name: "safety", value: "preserve warning", source: "simulation" }],
    criteria: ["scan cost", "accessibility"],
    evidence: [{ source: "simulation", reference: "pilot", claim: "split view is testable" }],
    options: [{ id: "split", primaryValue: "split view", relatedValues: [], compatibility: "valid" }],
    nextAction: "Record the pilot selection.",
  };
  return Object.fromEntries(recipe.tasks.map((task) => [
    task.output,
    task.output === "scope-map.json" ? JSON.stringify(scopeMap)
      : ["interfaces/contrast.json", "interfaces/selection-receipt.json"].includes(task.output) ? JSON.stringify(contrast)
        : task.output.endsWith(".json") ? JSON.stringify(sample(task.output_schema_contract)) : "# Pilot evidence\n",
  ]));
}

function assertArtifactMatrix(recipe) {
  const contents = validContents(recipe);
  const paths = requiredOutputPaths(recipe, artifactContext);
  assert.deepEqual(paths, recipe.tasks.map((task) => task.output), `${recipe.id} probe activates every declared output`);
  assert.deepEqual(validateExecutionArtifacts({ recipe, contents, context: artifactContext }), {
    ok: true,
    missing: [],
    malformed: [],
    issues: [],
    paths,
  }, `${recipe.id} valid artifact contract passes`);
  for (const path of paths) {
    const omitted = { ...contents };
    delete omitted[path];
    // `issues` is the field-level diagnosis that used to be missing: a
    // rejection that names only the file costs the worker a whole run.
    const issue = (text) => [text];
    const empty = { ok: false, missing: [path], malformed: [], issues: issue(`${path} is missing or empty`), paths };
    assert.deepEqual(validateExecutionArtifacts({ recipe, contents: omitted, context: artifactContext }), empty, `${recipe.id} rejects omitted ${path}`);
    const blank = { ...empty };
    const blankRun = validateExecutionArtifacts({ recipe, contents: { ...contents, [path]: " " }, context: artifactContext });
    assert.deepEqual(blankRun, blank, `${recipe.id} rejects blank ${path}`);
    if (!path.endsWith(".json")) continue;
    const notJson = validateExecutionArtifacts({ recipe, contents: { ...contents, [path]: "{not-json" }, context: artifactContext });
    assert.equal(notJson.ok, false, `${recipe.id} rejects malformed JSON ${path}`);
    assert.deepEqual(
      { missing: notJson.missing, malformed: notJson.malformed },
      { missing: [], malformed: [path] },
      `${recipe.id} rejects malformed JSON ${path}`,
    );
    assert.match(notJson.issues[0], /is not valid JSON/, `${recipe.id} says why the JSON failed`);
    const schemaInvalid = validateExecutionArtifacts({ recipe, contents: { ...contents, [path]: "{}" }, context: artifactContext });
    assert.equal(schemaInvalid.ok, false, `${recipe.id} rejects schema-invalid ${path}`);
    assert.deepEqual(
      { missing: schemaInvalid.missing, malformed: schemaInvalid.malformed },
      { missing: [], malformed: [path] },
      `${recipe.id} rejects schema-invalid ${path}`,
    );
    assert.ok(schemaInvalid.issues.length > 0, `${recipe.id} names the problem, not just the file`);
  }
}

function assertRoute(recipe, row) {
  const required = expectedCapabilities(recipe);
  const route = resolveExecutionRoute({ recipe, requiredCapabilities: required, nativeCapabilities: BB_NATIVE_CAPABILITIES, nativeAvailable: true });
  assert.equal(route.mode, row.expected_route, `${recipe.id} follows its recorded route`);
  if (recipe.write_policy === "artifact") {
    assertCapabilities(required, BB_NATIVE_CAPABILITIES);
    assert.deepEqual(route.missingCapabilities, [], `${recipe.id} has no missing native capability`);
  }
  else {
    const allCapabilities = Object.fromEntries([...knownCapabilities].map((capability) => [capability, true]));
    const failClosed = resolveExecutionRoute({ recipe, requiredCapabilities: required, nativeCapabilities: allCapabilities, nativeAvailable: true });
    assert.equal(failClosed.mode, "coordinator-sequential", `${recipe.id} stays fail-closed even with every capability`);
    assert.deepEqual(failClosed.preserves, recipe.fallback.preserves, `${recipe.id} preserves fallback guarantees`);
  }
}

exactKeys(manifest, ["schema_version", "validated_at", "host", "evidence", "recipes", "waivers"], "manifest");
assert.equal(manifest.schema_version, 1, "matrix schema version is pinned");
assert.match(manifest.validated_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/, "validation time is explicit");
assert.deepEqual(
  manifest.host,
  { name: "bb", version: "0.43.3", command: "bb workflows validate --script <rendered-recipe-source> --json" },
  "real host probe is explicit",
);
for (const identity of manifest.evidence) {
  exactKeys(identity, ["path", "sha256"], `evidence ${identity.path}`);
  assert.equal(isAbsolute(identity.path), false, "evidence path is repository-relative");
  assert.equal(identity.path.split("/").includes(".."), false, "evidence path stays in repository");
  assert.equal(identity.sha256, sha256(identity.path), `evidence matches current bytes: ${identity.path}`);
}
const evidencePaths = new Set(manifest.evidence.map((identity) => identity.path));
for (const path of ["data/stelow-recipe-catalog.json", "skills/stelow-workflow-orchestrator/recipe-catalog.json", "server/bb-workflow-bridge.ts", "lib/execution-artifacts.mjs", "lib/execution-route.mjs", "lib/bb-workflow-capabilities.mjs"]) assert.equal(evidencePaths.has(path), true, `matrix pins ${path}`);
assert.equal(
  sha256("data/stelow-recipe-catalog.json"),
  sha256("skills/stelow-workflow-orchestrator/recipe-catalog.json"),
  "source and generated catalogs are byte-identical",
);
const catalogIds = sortedUnique(recipes.map((recipe) => recipe.id), "catalog recipe ids");
const matrixIds = sortedUnique(manifest.recipes.map((row) => row.id), "matrix recipe ids");
assert.deepEqual(matrixIds, catalogIds, "matrix covers every generated recipe exactly once");

for (const recipe of recipes) {
  const row = rows.get(recipe.id);
  exactKeys(row, ["id", "classification", "expected_route", "probe", "execution_claim", "source_sha256", "permission_profile", "failure_policies", "human_boundaries", "outputs", ...(recipe.write_policy === "artifact" ? [] : ["waiver_id"])], `${recipe.id} row`);
  assert.equal(row.id, recipe.id, `${recipe.id} row id matches catalog`);
  assert.equal(
    row.classification,
    recipe.write_policy === "artifact" ? "low-risk-artifact" : "workspace-writer",
    `${recipe.id} classification is derived from write policy`,
  );
  assert.equal(row.probe, "host-validation+artifact-contract", `${recipe.id} records both real-host and contract probes`);
  assert.equal(row.execution_claim, recipe.write_policy === "artifact" ? "validation-only" : "waived", `${recipe.id} does not overclaim execution`);
  assert.match(row.source_sha256, /^[a-f0-9]{64}$/, `${recipe.id} records the exact host-validated source`);
  const renderedSource = renderInlineWorkflowScript(recipe, { localRunId: "exec_matrix" }).replace(/\n$/, "");
  assert.equal(createHash("sha256").update(renderedSource).digest("hex"), row.source_sha256, `${recipe.id} source hash matches the current renderer`);
  assert.equal(row.permission_profile, recipe.permission_profile, `${recipe.id} records inherited permissions`);
  assert.deepEqual(
    sortedUnique(row.failure_policies, `${recipe.id} failure policies`),
    [...new Set(recipe.tasks.map((task) => task.failure_policy))].sort(),
    `${recipe.id} failure matrix is exact`,
  );
  assert.deepEqual(
    row.human_boundaries,
    recipe.tasks.filter((task) => task.human_boundary !== "none").map((task) => task.id),
    `${recipe.id} human-wait matrix is exact`,
  );
  assert.deepEqual(row.outputs, recipe.tasks.map((task) => task.output), `${recipe.id} artifact matrix is exact`);
  assert.equal(recipe.fallback.mode, "sequential", `${recipe.id} has a sequential fallback`);
  assert.equal(recipe.fallback.preserves.includes("artifact"), true, `${recipe.id} fallback preserves artifacts`);
  assertTaskGraph(recipe);
  assertArtifactMatrix(recipe);
  assertRoute(recipe, row);
}

assert.equal(manifest.waivers.length, 1, "matrix has exactly one contextual waiver");
const waiver = manifest.waivers[0];
exactKeys(waiver, ["id", "recipe_id", "condition", "reason", "required_route", "native_pilot_allowed", "preserves"], "scope-batch waiver");
assert.deepEqual(waiver, {
  id: "workspace-writing-scope-batch",
  recipe_id: "scope-batch",
  condition: { recipe_id: "scope-batch", write_policy: "workspace" },
  reason: "Native fan-out is deferred on this host because file claims, isolated workers, transitive partition proof, parent merge, and parent verification are not proven. Host compilation and artifact contracts are recorded, but no native execution is claimed.",
  required_route: "coordinator-sequential",
  native_pilot_allowed: false,
  preserves: ["artifact", "claims", "parent-verification"],
}, "scope-batch waiver is explicit and complete");
assert.equal(rows.get("scope-batch").waiver_id, waiver.id, "scope-batch matrix row references its waiver");

// One-flag rollback pin: the recorded waiver value keeps scope-batch
// coordinator-sequential, and the pilot evaluator honors the same flag
// for a batch that would otherwise admit.
assert.equal(waiver.native_pilot_allowed, false, "the scope-batch waiver ships with the pilot off");
assert.equal(waiver.required_route, "coordinator-sequential", "flag off requires coordinator-sequential");
{
  const disjoint = [
    { scopeId: "scope-a", targetFiles: ["src/a.ts"] },
    { scopeId: "scope-b", targetFiles: ["src/b.ts"] },
  ];
  const capable = { "file-claims": true, "isolated-workspace": true };
  const rolledBack = evaluateScopeBatchPilot({
    scopes: disjoint,
    satisfiedScopeIds: ["scope-a", "scope-b"],
    nativeCapabilities: capable,
    nativePilotAllowed: waiver.native_pilot_allowed,
  });
  assert.equal(rolledBack.mode, waiver.required_route, "waiver flag off restores sequential in the pilot evaluator");
  assert.equal(rolledBack.code, "PILOT_DISABLED", "rollback names the disabled pilot");
  const overlapping = evaluateScopeBatchPilot({
    scopes: [
      { scopeId: "scope-a", targetFiles: ["src/shared.ts"] },
      { scopeId: "scope-b", targetFiles: ["src/shared.ts"] },
    ],
    satisfiedScopeIds: ["scope-a", "scope-b"],
    nativeCapabilities: capable,
    nativePilotAllowed: true,
  });
  assert.equal(overlapping.mode, "coordinator-sequential", "overlapping scopes never fan out, flag or not");
}

console.log(`recipe pilot matrix test ok: ${recipes.length} recipes, ${manifest.waivers.length} contextual waiver`);

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BB_NATIVE_CAPABILITIES } from "../lib/bb-workflow-capabilities.mjs";
import { EXECUTION_CAPABILITIES, assertCapabilities } from "../lib/execution-adapter.mjs";
import { requiredOutputPaths, safeArtifactPath, validateExecutionArtifacts } from "../lib/execution-artifacts.mjs";
import { resolveExecutionRoute } from "../lib/execution-route.mjs";
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
  if (schema.type === "string") return "pilot evidence";
  if (schema.type === "boolean") return true;
  assert.fail(`matrix cannot synthesize unsupported schema type: ${schema.type}`);
}

function validContents(recipe) {
  return Object.fromEntries(recipe.tasks.map((task) => [
    task.output,
    task.output.endsWith(".json") ? JSON.stringify(sample(task.output_schema_contract)) : "# Pilot evidence\n",
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
    paths,
  }, `${recipe.id} valid artifact contract passes`);
  for (const path of paths) {
    const omitted = { ...contents };
    delete omitted[path];
    assert.deepEqual(validateExecutionArtifacts({ recipe, contents: omitted, context: artifactContext }), { ok: false, missing: [path], malformed: [], paths }, `${recipe.id} rejects omitted ${path}`);
    assert.deepEqual(validateExecutionArtifacts({ recipe, contents: { ...contents, [path]: " " }, context: artifactContext }), { ok: false, missing: [path], malformed: [], paths }, `${recipe.id} rejects blank ${path}`);
    if (!path.endsWith(".json")) continue;
    assert.deepEqual(validateExecutionArtifacts({ recipe, contents: { ...contents, [path]: "{not-json" }, context: artifactContext }), { ok: false, missing: [], malformed: [path], paths }, `${recipe.id} rejects malformed JSON ${path}`);
    assert.deepEqual(validateExecutionArtifacts({ recipe, contents: { ...contents, [path]: "{}" }, context: artifactContext }), { ok: false, missing: [], malformed: [path], paths }, `${recipe.id} rejects schema-invalid ${path}`);
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
assert.deepEqual(manifest.host, { name: "bb", version: "0.43.3", command: "bb workflows validate --script <rendered-recipe-source> --json" }, "real host probe is explicit");
for (const identity of manifest.evidence) {
  exactKeys(identity, ["path", "sha256"], `evidence ${identity.path}`);
  assert.equal(isAbsolute(identity.path), false, "evidence path is repository-relative");
  assert.equal(identity.path.split("/").includes(".."), false, "evidence path stays in repository");
  assert.equal(identity.sha256, sha256(identity.path), `evidence matches current bytes: ${identity.path}`);
}
const evidencePaths = new Set(manifest.evidence.map((identity) => identity.path));
for (const path of ["data/stelow-recipe-catalog.json", "skills/stelow-workflow-orchestrator/recipe-catalog.json", "server/bb-workflow-bridge.ts", "lib/execution-artifacts.mjs", "lib/execution-route.mjs", "lib/bb-workflow-capabilities.mjs"]) assert.equal(evidencePaths.has(path), true, `matrix pins ${path}`);
assert.equal(sha256("data/stelow-recipe-catalog.json"), sha256("skills/stelow-workflow-orchestrator/recipe-catalog.json"), "source and generated catalogs are byte-identical");
const catalogIds = sortedUnique(recipes.map((recipe) => recipe.id), "catalog recipe ids");
const matrixIds = sortedUnique(manifest.recipes.map((row) => row.id), "matrix recipe ids");
assert.deepEqual(matrixIds, catalogIds, "matrix covers every generated recipe exactly once");

for (const recipe of recipes) {
  const row = rows.get(recipe.id);
  exactKeys(row, ["id", "classification", "expected_route", "probe", "execution_claim", "source_sha256", "permission_profile", "failure_policies", "human_boundaries", "outputs", ...(recipe.write_policy === "artifact" ? [] : ["waiver_id"])], `${recipe.id} row`);
  assert.equal(row.id, recipe.id, `${recipe.id} row id matches catalog`);
  assert.equal(row.classification, recipe.write_policy === "artifact" ? "low-risk-artifact" : "workspace-writer", `${recipe.id} classification is derived from write policy`);
  assert.equal(row.probe, "host-validation+artifact-contract", `${recipe.id} records both real-host and contract probes`);
  assert.equal(row.execution_claim, recipe.write_policy === "artifact" ? "validation-only" : "waived", `${recipe.id} does not overclaim execution`);
  assert.match(row.source_sha256, /^[a-f0-9]{64}$/, `${recipe.id} records the exact host-validated source`);
  const renderedSource = renderInlineWorkflowScript(recipe, { localRunId: "exec_matrix" }).replace(/\n$/, "");
  assert.equal(createHash("sha256").update(renderedSource).digest("hex"), row.source_sha256, `${recipe.id} source hash matches the current renderer`);
  assert.equal(row.permission_profile, recipe.permission_profile, `${recipe.id} records inherited permissions`);
  assert.deepEqual(sortedUnique(row.failure_policies, `${recipe.id} failure policies`), [...new Set(recipe.tasks.map((task) => task.failure_policy))].sort(), `${recipe.id} failure matrix is exact`);
  assert.deepEqual(row.human_boundaries, recipe.tasks.filter((task) => task.human_boundary !== "none").map((task) => task.id), `${recipe.id} human-wait matrix is exact`);
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

console.log(`recipe pilot matrix test ok: ${recipes.length} recipes, ${manifest.waivers.length} contextual waiver`);

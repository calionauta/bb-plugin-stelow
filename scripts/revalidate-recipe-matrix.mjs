#!/usr/bin/env node
/**
 * Revalidate the recipe pilot matrix against the real host (`bb`).
 *
 * The fixture (tests/fixtures/recipe-pilot-matrix.json) is evidence, not a
 * derived artifact: `validated_at` + `host` claim the rendered sources
 * recorded there passed `bb workflows validate` on that date. Recomputing
 * the SHAs locally without running the probes would fabricate that claim —
 * exactly what the test exists to catch. So this script does everything in
 * order and refuses to write unless every step actually happened:
 *
 *  1. require the `bb` CLI (fail fast naming it when absent);
 *  2. render every recipe from the current catalog (deterministic);
 *  3. run `bb workflows validate --script <rendered> --json` per recipe and
 *     require `"valid": true` for all (any failure aborts, writes nothing);
 *  4. only then rewrite the fixture: current catalog bytes, current
 *     rendered-source hashes, rows rebuilt from the catalog, fresh
 *     `validated_at`, and the host version the probe ran against.
 *
 * The test pins host version 0.45.0 (the host that produced the fixture in
 * this commit). If `bb --version` differs, this script refuses to write —
 * update the pin in tests/recipe-pilot-matrix.test.mjs in the same commit
 * as a revalidation.
 *
 * Run as:
 *   node --experimental-strip-types --import ./tests/register-ts-source.mjs \
 *     scripts/revalidate-recipe-matrix.mjs
 * (same invocation family as the test suites, since the renderer is .ts and
 * the tree resolves extension-less imports via the register hook).
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BB_NATIVE_CAPABILITIES } from "../lib/bb-workflow-capabilities.mjs";
import { resolveExecutionRoute } from "../lib/execution-route.mjs";
import { renderInlineWorkflowScript } from "../server/bb-workflow-bridge.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE = join(root, "tests/fixtures/recipe-pilot-matrix.json");
const PINNED_HOST_VERSION = "0.45.0";
const EVIDENCE_PATHS = [
  "data/stelow-recipe-catalog.json",
  "skills/stelow-workflow-orchestrator/recipe-catalog.json",
  "server/bb-workflow-bridge.ts",
  "lib/execution-artifacts.mjs",
  "lib/execution-route.mjs",
  "lib/bb-workflow-capabilities.mjs",
];

function die(message) {
  console.error(`revalidate-recipe-matrix: ${message}`);
  process.exit(1);
}

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function requireBb() {
  const probe = spawnSync("bash", ["-lc", "command -v bb"], { encoding: "utf8" });
  if (probe.status !== 0 || !probe.stdout.trim()) {
    die("`bb` CLI not found in this environment. The fixture claims host validation, "
      + "so revalidation must happen on a host with `bb`. Install/provide `bb`, then rerun this script.");
  }
  const versionOut = spawnSync("bash", ["-lc", "bb --version"], { encoding: "utf8" });
  const match = (versionOut.stdout + versionOut.stderr).match(/0\.\d+\.\d+/);
  const version = match ? match[0] : null;
  if (!version) die("could not read a version from `bb --version` output; refusing to proceed.");
  if (version !== PINNED_HOST_VERSION) {
    die(`host reports bb ${version}, but tests/recipe-pilot-matrix.test.mjs pins ${PINNED_HOST_VERSION}. `
      + `Update the pinned host version in the test in the same commit as a revalidation.`);
  }
  return version;
}

function validateHost(rendered, recipeId) {
  // Mirrors server/bb-workflow-bridge.ts: `bb workflows validate --script
  // <source>` takes the rendered SOURCE inline (never a path), run inside a
  // live BB project thread context (BB_PROJECT_ID/BB_THREAD_ID).
  const env = {
    ...process.env,
    BB_PROJECT_ID: "proj_a6wdkdcfkk",
    BB_THREAD_ID: "thr_hb5jjhjdkt",
  };
  const run = spawnSync("bash", ["-lc", "bb workflows validate --script \"$(cat)\" --json"], {
    encoding: "utf8",
    env,
    input: rendered,
  });
  let report = null;
  try {
    report = JSON.parse(run.stdout);
  } catch {
    die(`recipe ${recipeId}: could not parse host validation output: ${run.stderr}`);
  }
  if (report.valid !== true) {
    die(`recipe ${recipeId}: host validation not valid: ${JSON.stringify(report)}`);
  }
}

function requiredCapabilities(recipe) {
  return [...new Set([
    ...(recipe.required_capabilities ?? []),
    ...(recipe.tasks ?? []).flatMap((task) => task.requirements ?? []),
  ])].sort();
}

function expectedRoute(recipe) {
  const required = requiredCapabilities(recipe);
  const route = resolveExecutionRoute({
    recipe, requiredCapabilities: required, nativeCapabilities: BB_NATIVE_CAPABILITIES, nativeAvailable: true,
  });
  // Keep the fixture honest about what the test pins: artifact recipes must
  // have no missing native capability, others stay coordinator-sequential.
  if (recipe.write_policy === "artifact") {
    if ((route.missingCapabilities ?? []).length > 0) die(`${recipe.id}: missing native capabilities ${route.missingCapabilities.join(", ")}`);
  } else if (route.mode !== "coordinator-sequential") {
    die(`${recipe.id}: workspace write policy must stay coordinator-sequential`);
  }
  return route.mode;
}

function buildRow(recipe, rendered) {
  const artifact = recipe.write_policy === "artifact";
  const row = {
    id: recipe.id,
    classification: artifact ? "low-risk-artifact" : "workspace-writer",
    expected_route: expectedRoute(recipe),
    probe: "host-validation+artifact-contract",
    execution_claim: artifact ? "validation-only" : "waived",
    source_sha256: createHash("sha256").update(rendered).digest("hex"),
    permission_profile: recipe.permission_profile,
    failure_policies: [...new Set(recipe.tasks.map((task) => task.failure_policy))].sort(),
    human_boundaries: recipe.tasks.filter((task) => task.human_boundary !== "none").map((task) => task.id),
    outputs: recipe.tasks.map((task) => task.output),
  };
  if (!artifact) row.waiver_id = "workspace-writing-scope-batch";
  return row;
}

function main() {
  const version = requireBb();
  const catalog = JSON.parse(readFileSync(join(root, "data/stelow-recipe-catalog.json"), "utf8"));
  const manifest = JSON.parse(readFileSync(FIXTURE, "utf8"));

  const rows = [];
  for (const recipe of catalog.recipes ?? []) {
    const rendered = renderInlineWorkflowScript(recipe, { localRunId: "exec_matrix" }).replace(/\n$/, "");
    validateHost(rendered, recipe.id);
    rows.push(buildRow(recipe, rendered));
  }
  // Waivers are recorded product decisions, not re-derived: carry them over
  // verbatim. If a revalidation ever needs to change one, it is a separate
  // commit with its own review.
  const out = {
    schema_version: 1,
    validated_at: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
    host: { name: "bb", version, command: "bb workflows validate --script <rendered-recipe-source> --json" },
    evidence: EVIDENCE_PATHS.map((path) => ({ path, sha256: sha256File(join(root, path)) })),
    recipes: rows,
    waivers: manifest.waivers,
  };
  const tmp = `${FIXTURE}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(out, null, 2)}\n`, "utf8");
  renameSync(tmp, FIXTURE);
  console.log("recipe-pilot-matrix revalidated: fixture rewritten with fresh host evidence");
}

main();

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AUDIT_TRAIL_CONTRACT } from "../lib/audit-trail-contract.mjs";

// Vendor contract: every behavior of the vendored Stelow helper the plugin
// parses or relies on, executed for real in tmp dirs. A vendored bump that
// changes JSON shapes, exit codes, or scope fields breaks here — at sync
// time — instead of inside a worker turn. Behavior that only exists in
// newer upstream (human-headings fallback, `scope` subcommand) is pinned
// upstream and lands here on the sync that vendors it.
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const HELPER_SRC = join(root, "data", "stelow");

if (spawnSync("bash", ["--version"], { encoding: "utf8" }).status !== 0) {
  console.log("vendor contracts SKIPPED: bash is not available");
  process.exit(0);
}

// The portable-trail contract is genuinely shared: the helper stamps it,
// lib/audit-trail-contract.mjs reads it. A bump on either side without the
// other must fail here with both versions named.
const helperSrc = readFileSync(HELPER_SRC, "utf8");
assert.match(
  helperSrc,
  new RegExp(`^CONTRACT = "${AUDIT_TRAIL_CONTRACT}"$`, "m"),
  `vendored helper declares the contract this plugin reads ("${AUDIT_TRAIL_CONTRACT}")`,
);

const MACHINE_SPEC = [
  "[SCOPE-1] Login",
  "[TYPE] feature",
  "[MAX_ITERATIONS] 5",
  "Dependencies: none",
  "[TARGET_FILES]",
  "- src/auth.ts",
  "",
  "[SCOPE-2] Speed",
  "[TYPE] optimization",
  "Dependencies: SCOPE-1",
  "",
].join("\n");

function seedProject(specContent) {
  const dir = mkdtempSync(join(tmpdir(), "stelow-vendor-"));
  const stateRel = ".stelow/2026-09-21/sw-vendor";
  const stateDir = join(dir, stateRel);
  mkdirSync(join(stateDir, "plans"), { recursive: true });
  mkdirSync(join(dir, "scripts"), { recursive: true });
  writeFileSync(join(dir, "scripts", "stelow"), helperSrc);
  writeFileSync(join(dir, "stelow.json"), JSON.stringify({
    workflows: [{
      name: "vendor", workflowId: "card-vendor", dirHash: "sw-vendor",
      created: "2026-09-21T00:00:00.000Z", status: "in-progress", scopes: [],
    }],
  }));
  writeFileSync(join(stateDir, "plans", "spec-tech_v1.md"), specContent);
  const run = (args) => spawnSync("bash", [join(dir, "scripts", "stelow"), ...args], {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, PATH: process.env.PATH ?? "", STELOW_STATEDIR: stateDir },
  });
  return { dir, run, tracking: () => JSON.parse(readFileSync(join(dir, "stelow.json"), "utf8")) };
}

// Machine blocks parse into the exact scope shape loadCardScopes reads,
// with the exact --json keys advance parses and the exit codes it maps.
{
  const { dir, run, tracking } = seedProject(MACHINE_SPEC);
  try {
    const r = run(["sync-scopes", "--json"]);
    assert.equal(r.status, 0, "sync exits 0");
    assert.deepEqual(Object.keys(JSON.parse(r.stdout)).sort(), ["dirHash", "specTechFile", "synced"], "sync --json keys are stable");
    assert.equal(JSON.parse(r.stdout).synced, 2, "two blocks sync");
    const scopes = tracking().workflows[0].scopes;
    assert.deepEqual(scopes.map((scope) => scope.id), ["scope-1", "scope-2"], "scope ids derive");
    assert.deepEqual(
      scopes[0],
      { id: "scope-1", type: "feature", name: "Login", blockedBy: [], targetFiles: ["src/auth.ts"], maxIterations: 5, status: "pending" },
      "sync produces the full scope shape the host projects",
    );
    assert.deepEqual(scopes[1].blockedBy, ["scope-1"], "dependencies parse");
    assert.equal(run(["sync-scopes", "--json"]).status, 0, "re-sync stays exit 0");
    assert.equal(JSON.parse(run(["sync-scopes", "--json"]).stdout).synced, 0, "re-sync is a no-op");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Human headings do not parse in the vendored copy: warn plus exit 0 with
// scopes left as-is (the host's fail-closed gates own this case until the
// sync that vendors the fallback lands it here as synced: 2).
{
  const { dir, run, tracking } = seedProject("## Scopes\n\n### SCOPE-1: Human\n");
  try {
    const r = run(["sync-scopes", "--json"]);
    assert.equal(r.status, 0, "unparseable spec stays exit 0");
    assert.match(r.stderr, /no \[SCOPE-N\] blocks/, "the miss warns");
    assert.deepEqual(tracking().workflows[0].scopes, [], "scopes stay as-is");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// blockedBy cycles refuse at ingest (exit 1) instead of stalling — the
// advance gate relies on this refusal existing.
{
  const { dir, run } = seedProject("[SCOPE-1] A\nDependencies: SCOPE-2\n\n[SCOPE-2] B\nDependencies: SCOPE-1\n");
  try {
    const r = run(["sync-scopes", "--json"]);
    assert.equal(r.status, 1, "cycles refuse");
    assert.match(r.stderr, /cycle detected/, "the cycle names itself");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Usage errors stay exit 2 (the host maps codes, never collapses them).
{
  const { dir, run } = seedProject(MACHINE_SPEC);
  try {
    assert.equal(run(["sync-scopes", "--bogus"]).status, 2, "unknown flags exit 2");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log("vendor contracts test ok: trail contract, sync shapes, codes, cycle refusal");

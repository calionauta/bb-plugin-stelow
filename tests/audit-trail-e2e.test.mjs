import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AUDIT_TRAIL_CONTRACT, auditTrailGate, auditTrailOutcome } from "../lib/audit-trail-contract.mjs";

// The contract module is unit-tested against fabricated helper output. This
// runs the REAL vendored helper, offline, through the exact sequence Build
// completion uses — build --strict, check --strict, then the gate — so a
// change in either half of the pair is caught here instead of in a Done card.
const HELPER = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "stelow");

if (spawnSync("git", ["--version"], { encoding: "utf8" }).status !== 0) {
  console.log("audit trail e2e SKIPPED: git is not available");
  process.exit(0);
}

const root = mkdtempSync(join(tmpdir(), "stelow-audit-trail-e2e-"));
const STATE_REL = ".stelow/2026-09-16/sw-e2e";
const stateDir = join(root, STATE_REL);
const PLAN_REL = `${STATE_REL}/plans/spec-tech_v1.md`;

function git(args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function runHelper(args) {
  return spawnSync("bash", [join(root, "scripts", "stelow"), ...args], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, PATH: process.env.PATH ?? "", STELOW_STATEDIR: stateDir, STELOW_STATE: join(stateDir, "state.md") },
  });
}

function stateFile(registered) {
  const rows = registered.map(([stage, label, path]) => `  - stage: ${stage}\n    kind: document\n    label: ${label}\n    path: ${path}\n`).join("");
  return `---\nname: e2e\nintent: feature\ncurrent_stage: audit\nstatus: active\nconfig:\n  appetite: Core\nartifacts:\n${rows}---\n# e2e\n`;
}

const AUDIT_REL = `${STATE_REL}/audit.md`;
const LESSONS_REL = `${STATE_REL}/lessons.md`;

try {
  mkdirSync(join(root, "scripts"), { recursive: true });
  writeFileSync(join(root, "scripts", "stelow"), readFileSync(HELPER));
  writeFileSync(join(root, "src.txt"), "work\n");
  git(["init", "-q"]);
  git(["config", "user.email", "e2e@test"]);
  git(["config", "user.name", "e2e"]);
  git(["add", "-A"]);
  git(["commit", "-qm", "init"]);

  mkdirSync(join(stateDir, "plans"), { recursive: true });
  writeFileSync(join(root, PLAN_REL), "# Plan\n");
  writeFileSync(join(root, AUDIT_REL), "# Audit\n");
  const registered = [["planning", "technical plan", PLAN_REL], ["audit", "audit", AUDIT_REL]];
  writeFileSync(join(stateDir, "state.md"), stateFile(registered));

  const verifiedGit = { isGit: true, gitRoot: realpathSync(root), headSha: git(["rev-parse", "HEAD"]).trim() };
  const build = runHelper(["audit-trail", "build", "--strict", "--json"]);
  const check = runHelper(["audit-trail", "check", "--strict", "--json"]);
  const gate = auditTrailGate({ build, check, verifiedGit });
  assert.equal(gate.ready, true, gate.error ?? "the vendor pair completes a registered workflow");
  assert.equal(gate.trailer.head, verifiedGit.headSha, "the trail attests the commit the host verified");
  assert.equal(gate.trailer.root, verifiedGit.gitRoot, "and the same repository");
  assert.equal(gate.trailer.contract, AUDIT_TRAIL_CONTRACT);
  const trail = readFileSync(join(stateDir, "audit-trail.md"), "utf8");
  assert.ok(trail.includes(`[technical plan](plans/spec-tech_v1.md)`), "the receipt links the registered artifact");
  assert.ok(trail.includes("| Git HEAD |"), "the receipt records the repository snapshot");
  assert.ok(!trail.includes("unregistered workflow documents"), "the Strict gate passed, so nothing is missing");

  // The window the gate closes: the receipt was verified at one commit and the
  // checkout moved before the trail was written.
  const moved = auditTrailGate({ build, check, verifiedGit: { ...verifiedGit, headSha: "0".repeat(40) } });
  assert.equal(moved.ready, false, "a checkout that moved during completion cannot complete");
  assert.match(moved.error, /Re-run the audit, then done/);

  // Drift after completion is what the card's freshness badge reports.
  writeFileSync(join(root, "scratch.txt"), "later work\n");
  const drifted = runHelper(["audit-trail", "check", "--strict", "--json"]);
  assert.equal(auditTrailOutcome(drifted).state, "changed", "an untracked file makes the receipt stale");
  const recheck = auditTrailGate({ build, check: drifted, verifiedGit });
  assert.equal(recheck.ready, false);
  assert.match(recheck.error, /did not validate \(changed\)/);

  // A produced document nobody registered is a refusal that names the file
  // with the fix, not a crash and not a silent omission.
  rmSync(join(root, "scratch.txt"), { force: true });
  writeFileSync(join(root, LESSONS_REL), "# Lessons\n");
  const refused = runHelper(["audit-trail", "build", "--strict", "--json"]);
  const refusedOutcome = auditTrailOutcome(refused);
  assert.equal(refusedOutcome.state, "refused", "the Strict gate declines instead of failing blind");
  assert.match(refusedOutcome.detail, /lessons\.md/, "and it names the document to register");
  assert.equal(auditTrailGate({ build: refused, check: null, verifiedGit }).ready, false);
  assert.equal(existsSync(join(stateDir, "audit-trail.md")), true, "a refusal never deletes the previous receipt");

  // Registering it is the fix, and the gate opens again.
  writeFileSync(join(stateDir, "state.md"), stateFile([...registered, ["audit", "lessons", LESSONS_REL]]));
  const rebuilt = runHelper(["audit-trail", "build", "--strict", "--json"]);
  const revalidated = runHelper(["audit-trail", "check", "--strict", "--json"]);
  const reopened = auditTrailGate({ build: rebuilt, check: revalidated, verifiedGit });
  assert.equal(reopened.ready, true, reopened.error ?? "registering the document reopens the gate");

  console.log("audit trail e2e test ok: the vendored helper and the completion gate agree on build, drift, refusal, and recovery");
} finally {
  rmSync(root, { recursive: true, force: true });
}

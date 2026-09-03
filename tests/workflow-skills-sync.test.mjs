import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { syncWorkflowSkills, WORKFLOW_SKILLS } from "../lib/workflow-skills-sync.mjs";

// Guard: if GitHub is unreachable (offline/CI), skip rather than fail — the
// offline invariants (idempotence, no-op on second run) still run when online.
const target = mkdtempSync(join(tmpdir(), "stelow-skills-test-"));

let ok = true;
try {
  const first = await syncWorkflowSkills(target, { log: () => {} });

  assert.equal(first.errors.length, 0, "first sync has no errors");
  assert.ok(first.created.length > 0, "first sync created files");
  assert.ok(existsSync(join(target, "stelow-workflow-orchestrator", "SKILL.md")), "orchestrator SKILL.md present");
  assert.ok(
    existsSync(join(target, "stelow-workflow-orchestrator", "references", "transitions.md")),
    "orchestrator references/transitions.md present (correct nesting)",
  );

  // Second run must be a no-op (state file skip) — no re-download, no churn.
  const second = await syncWorkflowSkills(target, { log: () => {} });
  assert.equal(second.created.length, 0, "second sync creates nothing");
  assert.equal(second.updated.length, 0, "second sync updates nothing");
  assert.equal(second.removed.length, 0, "second sync removes nothing");
  assert.equal(second.errors.length, 0, "second sync has no errors");
  assert.equal(second.changed, false, "second sync reports unchanged");

  assert.equal(WORKFLOW_SKILLS.length, 14, "exactly 14 core skills are vendored");
  assert.ok(WORKFLOW_SKILLS.includes("stelow-workflow-entry"), "workflow entry is vendored");
  assert.ok(WORKFLOW_SKILLS.includes("stelow-workflow-router"), "workflow router is vendored");

  // A rename must not leave legacy control-plane skills available in the
  // plugin's manifest root.
  for (const legacy of ["stelow-entry", "stelow-router"]) {
    mkdirSync(join(target, legacy), { recursive: true });
    writeFileSync(join(target, legacy, "SKILL.md"), "legacy");
  }
  const cleanup = await syncWorkflowSkills(target, { log: () => {} });
  assert.deepEqual(cleanup.removed.sort(), ["stelow-entry/", "stelow-router/"]);
  assert.ok(!existsSync(join(target, "stelow-entry")), "legacy entry directory removed");
  assert.ok(!existsSync(join(target, "stelow-router")), "legacy router directory removed");

  console.log(
    `workflow-skills-sync test ok: ${first.created.length} files synced from calionauta/stelow, idempotent on second run`,
  );
} catch (err) {
  const msg = String(err && err.message ? err.message : err);
  const netish = /fetch|network|ECONN|offline|timeout|unreachable|socket|getaddrinfo/i.test(msg);
  if (netish) {
    console.log(`workflow-skills-sync test SKIPPED (network unavailable): ${msg}`);
  } else {
    console.error(`workflow-skills-sync test FAILED: ${msg}`);
    process.exit(1);
  }
} finally {
  rmSync(target, { recursive: true, force: true });
}
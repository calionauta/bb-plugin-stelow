import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
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

  // An explicit statePath keeps the target dir free of dotfiles (bb scans
  // skills/ for candidates and warns on strays) without leaking state into
  // a shared parent: each target still owns its own state.
  const root2 = mkdtempSync(join(tmpdir(), "stelow-skills-root-"));
  try {
    const target2 = join(root2, "skills");
    const state2 = join(root2, ".sync-state.json");
    mkdirSync(target2, { recursive: true });
    const a = await syncWorkflowSkills(target2, { log: () => {}, statePath: state2 });
    assert.equal(a.errors.length, 0, "explicit-state sync has no errors");
    assert.ok(a.created.length > 0, "explicit-state sync created files");
    assert.ok(existsSync(state2), "state lands at the explicit path");
    const strays = readdirSync(target2).filter((e) => e.startsWith("."));
    assert.deepEqual(strays, [], "no dotfiles inside skills/");
  const b = await syncWorkflowSkills(target2, { log: () => {}, statePath: state2 });
  assert.equal(b.changed, false, "explicit-state second run is a no-op");
  assert.equal(b.errors.length, 0, "explicit-state second run has no errors");
  const syncedAt = JSON.parse(readFileSync(state2, "utf8"))["$syncedAt"];
  assert.equal(typeof syncedAt, "number", "sync records its verification timestamp");
  assert.ok(syncedAt > 0 && syncedAt <= Date.now(), "verification timestamp is plausible");

    // Legacy in-skills state migrates once: it is consumed (no redundant
    // re-download storm beyond the single migration run) and then removed.
    const legacy = join(target2, ".sync-state.json");
    writeFileSync(legacy, JSON.stringify({ "stelow-workflow-orchestrator/SKILL.md": "deadbeef" }));
    const c = await syncWorkflowSkills(target2, { log: () => {}, statePath: state2 });
    assert.equal(c.errors.length, 0, "migration run has no errors");
    assert.ok(!existsSync(legacy), "legacy in-skills state removed after migration");
  } finally {
    rmSync(root2, { recursive: true, force: true });
  }

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
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { syncWorkflowSkills, WORKFLOW_SKILLS } from "../lib/workflow-skills-sync.mjs";

// Guard: if GitHub is unreachable (offline/CI), skip rather than fail — the
// offline invariants (idempotence, no-op on second run) still run when online.
const target = mkdtempSync(join(tmpdir(), "stelow-skills-test-"));
const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

// GitHub being offline or rate-limited is the sync's normal fail-soft path —
// it reports those in `errors` and never throws. Skip only those; a missing
// file upstream, a truncated tree, or a sha mismatch is a real defect.
const UNAVAILABLE = /(403|429|50\d)\b|fetch failed|network|ECONN|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|offline|timeout|unreachable|socket|getaddrinfo|stale \S+: content sha mismatch/i;

/** Throw with the sync's own error text, so the guard above can classify it. */
function assertCleanSync(result, label) {
  if (result.errors.length) throw new Error(`${label} failed: ${result.errors.join("; ")}`);
}

/** Offline still proves every vendored skill shipped. */
function assertVendoredSkills() {
  const skillsDir = join(pluginRoot, "skills");
  for (const skill of WORKFLOW_SKILLS) {
    assert.ok(existsSync(join(skillsDir, skill, "SKILL.md")), `${skill} ships a SKILL.md`);
  }
  assert.ok(
    existsSync(join(skillsDir, "stelow-workflow-orchestrator", "references", "transitions.md")),
    "orchestrator references/transitions.md present (correct nesting)",
  );
}

try {
  const first = await syncWorkflowSkills(target, { log: () => {} });

  assertCleanSync(first, "first sync");
  assert.ok(first.created.length > 0, "first sync created files");
  assert.ok(existsSync(join(target, "stelow-workflow-orchestrator", "SKILL.md")), "orchestrator SKILL.md present");
  assert.ok(
    existsSync(join(target, "stelow-workflow-orchestrator", "references", "transitions.md")),
    "orchestrator references/transitions.md present (correct nesting)",
  );

  // Second run must be a no-op (state file skip) — no re-download, no churn.
  const second = await syncWorkflowSkills(target, { log: () => {} });
  assertCleanSync(second, "second sync");
  assert.equal(second.created.length, 0, "second sync creates nothing");
  assert.equal(second.updated.length, 0, "second sync updates nothing");
  assert.equal(second.removed.length, 0, "second sync removes nothing");
  assert.equal(second.changed, false, "second sync reports unchanged");

  assert.ok(
    existsSync(join(target, "stelow-product-pricing", "SKILL.md")),
    "product playbooks ship vendored, not just workflow skills",
  );

  // Retired skills prune by directory: a stale stelow-* dir disappears,
  // anything not starting with stelow- is never touched.
  const retired = join(target, "stelow-product-workflow");
  const foreign = join(target, "other-thing");
  mkdirSync(retired, { recursive: true });
  writeFileSync(join(retired, "SKILL.md"), "# retired");
  mkdirSync(foreign, { recursive: true });
  writeFileSync(join(foreign, "x.md"), "# foreign");
  const third = await syncWorkflowSkills(target, { log: () => {} });
  assertCleanSync(third, "prune run");
  assert.ok(!existsSync(retired), "retired stelow-* dir pruned");
  assert.ok(existsSync(join(foreign, "x.md")), "non-stelow dirs untouched");

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
    assertCleanSync(a, "explicit-state sync");
    assert.ok(a.created.length > 0, "explicit-state sync created files");
    assert.ok(existsSync(state2), "state lands at the explicit path");
    const strays = readdirSync(target2).filter((e) => e.startsWith("."));
    assert.deepEqual(strays, [], "no dotfiles inside skills/");
    const b = await syncWorkflowSkills(target2, { log: () => {}, statePath: state2 });
    assertCleanSync(b, "explicit-state second run");
    assert.equal(b.changed, false, "explicit-state second run is a no-op");
    const syncedAt = JSON.parse(readFileSync(state2, "utf8"))["$syncedAt"];
    assert.equal(typeof syncedAt, "number", "sync records its verification timestamp");
    assert.ok(syncedAt > 0 && syncedAt <= Date.now(), "verification timestamp is plausible");
  } finally {
    rmSync(root2, { recursive: true, force: true });
  }

  console.log(
    `workflow-skills-sync test ok: ${first.created.length} files synced from calionauta/stelow, idempotent on second run`,
  );
} catch (err) {
  const msg = String(err && err.message ? err.message : err);
  if (UNAVAILABLE.test(msg)) {
    try {
      assertVendoredSkills();
      console.log(`workflow-skills-sync test SKIPPED (GitHub unavailable); vendored skills verified offline: ${msg}`);
    } catch (offlineError) {
      console.error(`workflow-skills-sync test FAILED: vendored skills invalid — ${offlineError.message}`);
      process.exit(1);
    }
  } else {
    console.error(`workflow-skills-sync test FAILED: ${msg}`);
    process.exit(1);
  }
} finally {
  rmSync(target, { recursive: true, force: true });
}

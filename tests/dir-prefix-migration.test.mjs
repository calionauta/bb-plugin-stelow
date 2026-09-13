import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyDirRename, legacyEntryForHash, migrateTrackingHashes, needsPrefixMigration, planDirRename, swDirHash } from "../lib/dir-prefix-migration.mjs";

// Regression: the pw- → sw- standardization (v0.6.0) must move every stored
// identity exactly once — state dir, approvals dir, and both indexes (cards
// table + stelow.json) — and never touch an already-migrated entry.

assert.equal(swDirHash("pw-card_1"), "sw-card_1", "the prefix swaps, the owner survives");
assert.equal(swDirHash("pw-ab12-cd34"), "sw-ab12-cd34", "random hashes swap too");
assert.equal(swDirHash("sw-card_1"), "sw-card_1", "migrated hashes are stable (idempotent)");
assert.equal(swDirHash(""), "", "empty stays empty");
assert.equal(swDirHash(null), "", "non-strings stay empty");
assert.equal(needsPrefixMigration("pw-x"), true, "pw- needs the move");
assert.equal(needsPrefixMigration("sw-x"), false, "sw- is done");
assert.equal(needsPrefixMigration(null), false, "missing hashes are metadata-only");

const plan = planDirRename({ workflowId: "card_1", dirHash: "pw-card_1", created: "2026-09-13T10:00:00.000Z" });
assert.deepEqual(
  { from: plan.fromStateRel, to: plan.toStateRel },
  { from: ".stelow/2026-09-13/pw-card_1", to: ".stelow/2026-09-13/sw-card_1" },
  "the date segment is pinned, only the trailing hash swaps",
);
assert.equal(plan.fromApprovalsRel, ".stelow/approvals/pw-card_1", "approvals ride the same hash");
assert.equal(planDirRename({ workflowId: "card_1", dirHash: "sw-card_1", created: "2026-09-13T10:00:00.000Z" }), null, "migrated entries plan nothing");
assert.equal(planDirRename({ workflowId: "card_1", dirHash: "pw-x" }), null, "a hash with no date has no resolvable dir");

// Real I/O: the planner's output drives real renames in a tmp workspace.
const root = mkdtempSync(join(tmpdir(), "sw-migrate-"));
mkdirSync(join(root, ".stelow/2026-09-13/pw-card_1"), { recursive: true });
writeFileSync(join(root, ".stelow/2026-09-13/pw-card_1/state.md"), "current_stage: audit\n");
mkdirSync(join(root, ".stelow/approvals/pw-card_1"), { recursive: true });
const applied = applyDirRename(root, plan);
assert.equal(applied.state, "moved", "the state dir moves");
assert.equal(applied.approvals, "moved", "the approvals dir moves");
assert.ok(existsSync(join(root, ".stelow/2026-09-13/sw-card_1/state.md")), "content rides along");
assert.ok(!existsSync(join(root, ".stelow/2026-09-13/pw-card_1")), "no husk left behind");
const rerun = applyDirRename(root, plan);
assert.equal(rerun.state, "missing", "a second boot finds nothing to move");

// Both indexes rewrite together or not at all per entry.
const tracked = migrateTrackingHashes(
  [{ workflowId: "card_1", dirHash: "pw-card_1" }, { workflowId: "card_2", dirHash: "sw-card_2" }],
  [{ fromHash: "pw-card_1", toHash: "sw-card_1" }],
);
assert.equal(tracked.changed, 1, "only the pw- entry rewrites");
assert.equal(tracked.workflows[0].dirHash, "sw-card_1", "stelow.json follows the move");
assert.equal(tracked.workflows[1].dirHash, "sw-card_2", "migrated entries are untouched");

// Legacy schema: entries seeded before the immutable-owner scheme carry no
// workflowId. They still migrate — matched by their unique stored hash —
// while owner-keyed entries keep the strict path and never reach the fallback.
const legacyWorkflows = [
  { name: "old thing", dirHash: "pw-legacy1", created: "2026-09-09T12:00:00.000Z" },
  { workflowId: "card_9", dirHash: "pw-card_9", created: "2026-09-13T10:00:00.000Z" },
];
assert.deepEqual(legacyEntryForHash(legacyWorkflows, "pw-legacy1")?.dirHash, "pw-legacy1", "a legacy entry matches by hash alone");
assert.equal(legacyEntryForHash(legacyWorkflows, "pw-card_9"), null, "an owner-keyed entry never falls back");
assert.equal(legacyEntryForHash(legacyWorkflows, "pw-missing"), null, "an unknown hash matches nothing");
assert.equal(legacyEntryForHash(legacyWorkflows, null), null, "a missing hash matches nothing");
const legacyPlan = planDirRename({ ...legacyEntryForHash(legacyWorkflows, "pw-legacy1"), workflowId: "card_legacy" });
assert.deepEqual(
  { from: legacyPlan.fromStateRel, to: legacyPlan.toStateRel },
  { from: ".stelow/2026-09-09/pw-legacy1", to: ".stelow/2026-09-09/sw-legacy1" },
  "a legacy entry plans the same move off its own created date",
);

console.log("dir prefix migration test ok: plan, real renames, idempotent rerun, index rewrite, legacy fallback");

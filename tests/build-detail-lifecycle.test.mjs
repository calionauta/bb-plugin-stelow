import assert from "node:assert/strict";
import test from "node:test";
import {
  BUILD_LIFECYCLE_ACTIONS,
  buildDiscardConfirmation,
  buildLifecycleOutcome,
} from "../lib/build-detail-lifecycle.mjs";

test("Build lifecycle owns every card action", () => {
  assert.deepEqual(BUILD_LIFECYCLE_ACTIONS, [
    "archive", "delete", "discard", "promote", "attach-recovery",
    "create-recovery-audit", "repair", "retry", "restart", "start", "split",
  ]);
});

test("destructive actions close only after host confirmation", () => {
  assert.deepEqual(buildLifecycleOutcome("archive", { archived: false }), {
    ok: false,
    error: "Archive did not take — the card is gone.",
  });
  assert.deepEqual(buildLifecycleOutcome("archive", { archived: true }), {
    ok: true,
    success: "Card archived.",
    close: true,
  });
  assert.equal(buildLifecycleOutcome("delete", { deleted: false, error: "Still running" }).error, "Still running");
  assert.equal(buildLifecycleOutcome("delete", { deleted: true }).close, true);
  assert.equal(buildLifecycleOutcome("discard", { ok: false, error: "Dirty worktree" }).close, undefined);
  assert.equal(buildLifecycleOutcome("discard", { ok: true, summary: "Reverted 3 files" }).success, "Reverted 3 files");
  assert.equal(buildLifecycleOutcome("discard", { ok: true }).close, true);
});

test("discard preview refuses before opening confirmation", () => {
  assert.deepEqual(buildDiscardConfirmation({ eligible: false, reason: "Commits exist" }), {
    eligible: false,
    error: "Commits exist",
  });
  assert.deepEqual(buildDiscardConfirmation({ eligible: false }), {
    eligible: false,
    error: "Nothing safe to discard.",
  });
  assert.deepEqual(buildDiscardConfirmation({ eligible: true }), {
    eligible: true,
    confirmation: { title: "Discard this card’s work?", body: "" },
  });
  assert.deepEqual(buildDiscardConfirmation({ eligible: true, confirmTitle: "Revert work?", confirmBody: "Three files" }).confirmation, {
    title: "Revert work?",
    body: "Three files",
  });
});

test("promotion and recovery handoffs refresh only on success", () => {
  assert.equal(buildLifecycleOutcome("promote", { ok: false, error: "No project" }).reload, undefined);
  assert.deepEqual(buildLifecycleOutcome("promote", { ok: true, projectName: "Atlas" }), {
    ok: true,
    success: 'Project "Atlas" created — a new project worker is continuing the workflow.',
    reload: true,
  });
  assert.equal(buildLifecycleOutcome("attach-recovery", { ok: true }).reload, true);
  assert.equal(buildLifecycleOutcome("attach-recovery", { ok: false, error: "Unregistered project" }).error, "Unregistered project");
  assert.equal(buildLifecycleOutcome("create-recovery-audit", { ok: true }).auditCardId, undefined);
  assert.equal(buildLifecycleOutcome("create-recovery-audit", { ok: true, auditCardId: "card-audit" }).auditCardId, "card-audit");
});

test("repair reports the chosen intent and refuses a false reseed", () => {
  assert.deepEqual(buildLifecycleOutcome("repair", { reseeded: false, error: "Active worker" }, { intent: "bugfix", intentLabels: { bugfix: "Bug fix" } }), {
    ok: false,
    error: "Active worker",
  });
  assert.equal(buildLifecycleOutcome("repair", { reseeded: true, reclassified: true }, { intent: "bugfix", intentLabels: { bugfix: "Bug fix" } }).success, "Workflow reclassified as Bug fix and restarted from triage.");
  assert.equal(buildLifecycleOutcome("repair", { reseeded: true, reclassified: false }, { intent: "feature" }).success, "Fresh worker started from triage.");
});

test("worker and split outcomes preserve host errors and success effects", () => {
  assert.equal(buildLifecycleOutcome("retry", { ok: false }).error, "Retry failed. Try Restart fresh instead.");
  assert.equal(buildLifecycleOutcome("retry", { ok: true }).reload, true);
  assert.equal(buildLifecycleOutcome("restart", { ok: false, error: "Cannot stop" }).error, "Cannot stop");
  assert.equal(buildLifecycleOutcome("restart", { ok: true }).success, "Worker restarted — continuing from the current stage.");
  assert.equal(buildLifecycleOutcome("start", { ok: false }).error, "Start failed.");
  assert.equal(buildLifecycleOutcome("start", { ok: true }).success, "Worker started — the card moved from Bucket and is triaging.");
  assert.equal(buildLifecycleOutcome("split", { ok: false, error: "No worker" }).error, "No worker");
  assert.equal(buildLifecycleOutcome("split", { ok: true }).reload, true);
});

test("unknown lifecycle action fails fast", () => {
  assert.throws(() => buildLifecycleOutcome("unknown", {}), /Unknown Build lifecycle action: unknown/);
});

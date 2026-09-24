import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDiscardConfirmation,
  buildLifecycleOutcome,
} from "../lib/build-detail-lifecycle.mjs";

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

test("promotion and recovery effects follow successful handoffs", () => {
  assert.equal(buildLifecycleOutcome("promote", { ok: false, error: "No project" }).refresh, undefined);
  assert.deepEqual(buildLifecycleOutcome("promote", { ok: true, projectName: "Atlas" }), {
    ok: true,
    success: 'Project "Atlas" created — a new project worker is continuing the workflow.',
    refresh: true,
  });
  assert.deepEqual(buildLifecycleOutcome("attach-recovery", { ok: true }), {
    ok: true,
    success: "Checkout attached for review. No files, branch, or Git history were changed.",
    refresh: true,
    refreshRecovery: true,
  });
  assert.equal(buildLifecycleOutcome("attach-recovery", { ok: false }).refreshRecovery, undefined);
  assert.equal(buildLifecycleOutcome("create-recovery-audit", { ok: true }).refreshRecovery, undefined);
  assert.deepEqual(buildLifecycleOutcome("create-recovery-audit", { ok: true, auditCardId: "card-audit" }), {
    ok: true,
    success: "Recovery audit started in the registered project workspace.",
    refresh: true,
    refreshRecovery: true,
    auditCardId: "card-audit",
  });
});

test("repair reports the chosen intent and refreshes only after a reseed", () => {
  const failed = buildLifecycleOutcome(
    "repair",
    { reseeded: false, error: "Active worker" },
    { intent: "bugfix", intentLabels: { bugfix: "Bug fix" } },
  );
  assert.deepEqual(failed, { ok: false, error: "Active worker" });
  assert.equal(failed.refresh, undefined);
  const reclassified = buildLifecycleOutcome(
    "repair",
    { reseeded: true, reclassified: true },
    { intent: "bugfix", intentLabels: { bugfix: "Bug fix" } },
  );
  assert.equal(reclassified.success, "Workflow reclassified as Bug fix and restarted from triage.");
  assert.equal(reclassified.refresh, true);
  assert.equal(
    buildLifecycleOutcome("repair", { reseeded: true, reclassified: false }, { intent: "feature" }).success,
    "Fresh worker started from triage.",
  );
});

test("resume actions always refresh while split refreshes only on success", () => {
  for (const action of ["retry", "restart", "start"]) {
    assert.equal(buildLifecycleOutcome(action, { ok: false }).refresh, true, `${action} refreshes failed host state`);
    assert.equal(buildLifecycleOutcome(action, { ok: true }).refresh, true);
  }
  assert.equal(buildLifecycleOutcome("retry", { ok: false }).error, "Retry failed. Try Restart fresh instead.");
  assert.equal(buildLifecycleOutcome("restart", { ok: false, error: "Cannot stop" }).error, "Cannot stop");
  assert.equal(buildLifecycleOutcome("start", { ok: false }).error, "Start failed.");
  assert.equal(buildLifecycleOutcome("split", { ok: false }).refresh, undefined);
  assert.equal(buildLifecycleOutcome("split", { ok: true }).refresh, true);
});

test("unknown lifecycle action fails fast", () => {
  assert.throws(() => buildLifecycleOutcome("unknown", {}), /Unknown Build lifecycle action: unknown/);
});

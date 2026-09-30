/**
 * `pendingScopes` is the number a reader actually sees on the card.
 *
 * The advisory warning in `cli-verify.ts` was tested while this count was not,
 * so the defect it describes could have been fixed in one surface and shipped
 * in the other: a card whose audit deliberately set a rework scope aside would
 * still read "1 scope still open" under a fix that had already been written.
 * The dep that fixes it (`isSkippedStatus`) was optional with a `() => false`
 * default, which meant a caller that forgot it got the old counting with no
 * error anywhere — the same failure mode, one layer down.
 *
 * Split out of `runtime-question-answers.test.mjs` rather than added to it: that
 * file was already over the 400-line budget, and the baseline forbids growing a
 * file that is over rather than splitting it.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { buildGapSummary } from "../server/runtime/gap-summary.ts";

function card(overrides = {}) {
  return {
    id: "card_1",
    project_id: "project_1",
    name: "Useful",
    prompt: "Build it",
    intent: "bugfix",
    status: "completed",
    stage: "audit",
    activity: "idle",
    worker_thread_id: "thread_1",
    kind: "build",
    created_at: 1,
    updated_at: 2,
    ...overrides,
  };
}

const TIMELINE = { leadMs: 10, cycleMs: 20 };

/**
 * Two escalated findings, each with a rework scope, one of them deliberately
 * set aside. Every other field is identical between the two calls below, so the
 * skipped scope is the only thing that can move the count.
 */
function twoScopesOneSetAside() {
  return {
    matched: true,
    failures: [],
    totals: { total: 2, fixed: 0, documented: 0, escalated: 2 },
    gaps: [
      { description: "Set aside here", resolution: "escalate" },
      { description: "Still to do", resolution: "escalate" },
    ],
    escalated: [{ description: "Set aside here" }, { description: "Still to do" }],
    auditGapScopes: [
      { id: "scope_1", name: "Set aside", status: "skipped", gap: "Set aside here" },
      { id: "scope_2", name: "Open", status: "planned", gap: "Still to do" },
    ],
    critiqueText: "critique",
  };
}

test("a skipped rework scope does not inflate the pending count", () => {
  const counted = buildGapSummary(
    card(),
    twoScopesOneSetAside(),
    TIMELINE,
    (status) => status === "done",
    (status) => status === "skipped",
  );

  assert.equal(counted.pendingScopes, 1, "one of the two scopes is still open");
  assert.equal(counted.unscoped, 0);
  // The set-aside scope is not hidden either. It is reported with its
  // disposition, which is the difference between "resolved" and "absent".
  assert.equal(
    counted.items.find((item) => item.description === "Set aside here").scopeStatus,
    "skipped",
  );
  assert.equal(
    counted.items.find((item) => item.description === "Still to do").scopeStatus,
    "planned",
  );
});

test("the done-only predicate is the defect, asserted as a number", () => {
  // Same two scopes, same state, with a predicate that does not know "skipped".
  // This is what the card showed before the fix. Asserting the wrong number is
  // what makes the test fail if the predicate is ever weakened back, rather
  // than only failing if somebody deletes the call.
  const doneOnly = buildGapSummary(
    card(),
    twoScopesOneSetAside(),
    TIMELINE,
    (status) => status === "done",
    () => false,
  );

  assert.equal(doneOnly.pendingScopes, 2, "done-only counting is the defect");
  assert.equal(
    buildGapSummary(card(), twoScopesOneSetAside(), TIMELINE, (s) => s === "done", (s) => s === "skipped").pendingScopes,
    1,
  );
});

test("a set-aside scope with no open scope left reports zero, not one", () => {
  // The shape that actually parked card_hh2nwqs4: every rework scope the audit
  // produced was `skipped`, so the card had nothing left to execute and the
  // count said it still had something open.
  const allSetAside = {
    ...twoScopesOneSetAside(),
    totals: { total: 2, fixed: 0, documented: 0, escalated: 2 },
    auditGapScopes: [
      { id: "scope_1", name: "Set aside", status: "skipped", gap: "Set aside here" },
      { id: "scope_2", name: "Also set aside", status: "skipped", gap: "Still to do" },
    ],
  };

  const summary = buildGapSummary(
    card(),
    allSetAside,
    TIMELINE,
    (status) => status === "done",
    (status) => status === "skipped",
  );

  assert.equal(summary.pendingScopes, 0, "nothing is open");
  assert.equal(summary.unscoped, 0, "and nothing is escalated without a scope");
});
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { FROZEN_ACCEPTANCE_FILE } from "../lib/audit-verification.mjs";
import {
  auditableBuildDone,
  callsNamed,
  cliHarness,
  NO_GAPS,
  WORKSPACE,
} from "./helpers/cli-harness.mjs";

/** The Build completion chain: the gates between owned state and the Done
 * write, each one a refusal naming the fix, and the one path where the card
 * is allowed to complete. */

test("a build done with a shallow workflow document refuses and names the rewrite", async () => {
  const { invoke, calls } = cliHarness({
    files: { "/w/.stelow/state/state.md": "current_stage: audit\n" },
    docDepths: [
      { label: "Product Spec", path: "docs/spec-product.md", failures: ["no competitor table"] },
    ],
  });
  const result = await invoke(["done"]);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /FAIL Product Spec \(docs\/spec-product\.md\): needs depth/);
  assert.match(result.stderr, /no competitor table/);
  assert.deepEqual(
    callsNamed(calls, "updateCard"),
    [],
    "a shallow document never completes the card",
  );
  assert.deepEqual(callsNamed(calls, "releaseClaims"), []);
});

test("a build done with an escalated gap that has no rework scope refuses and names the loop", async () => {
  const { invoke, calls } = cliHarness({
    files: { "/w/.stelow/state/state.md": "current_stage: audit\n" },
    gapState: {
      ...NO_GAPS,
      matched: true,
      totals: { total: 3, fixed: 1, documented: 1, escalated: 1 },
      escalated: [{ description: "checkout ignores promo codes" }],
      auditGapScopes: [],
    },
  });
  const result = await invoke(["done"]);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /1 escalated gap\(s\) have no rework scope/);
  assert.match(result.stderr, /bb stelow gap-scopes/);
  assert.match(result.stderr, /- checkout ignores promo codes/);
  assert.deepEqual(
    callsNamed(calls, "updateCard"),
    [],
    "an unlinked escalated gap never completes the card",
  );
});

test("a build done with documented debt past its expires date refuses and names the three exits", async () => {
  const { invoke, calls } = cliHarness({
    files: { "/w/.stelow/state/state.md": "current_stage: audit\n" },
    gapState: {
      ...NO_GAPS,
      matched: true,
      totals: { total: 1, fixed: 0, documented: 1, escalated: 0 },
      gaps: [
        { description: "Rename helper", resolution: "documented", evidence: null, expires: "2023-01-01", owner: "ana" },
      ],
      escalated: [],
      auditGapScopes: [],
    },
  });
  const result = await invoke(["done"]);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /past their expires date/);
  assert.match(result.stderr, /Rename helper \(past 2023-01-01, owner ana\)/);
  assert.match(result.stderr, /fixed/);
  assert.match(result.stderr, /gap-scopes/);
  assert.match(result.stderr, /re-date/);
  assert.deepEqual(
    callsNamed(calls, "updateCard"),
    [],
    "expired debt never completes the card",
  );
});

test("documented debt dated in the future does not block done on expiry", async () => {
  const { invoke, calls } = cliHarness(
    auditableBuildDone({
      gapState: {
        ...NO_GAPS,
        matched: true,
        totals: { total: 1, fixed: 0, documented: 1, escalated: 0 },
        gaps: [
          { description: "Rename helper", resolution: "documented", evidence: null, expires: "2099-01-01", owner: "ana" },
        ],
        escalated: [],
        auditGapScopes: [],
      },
    }),
  );
  const result = await invoke(["done"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(
    callsNamed(calls, "updateCard").map(([, , fields]) => fields.status),
    ["completed"],
    "settled debt completes",
  );
});

test("a build done with an audit-gap rework scope still open refuses before completing", async () => {
  const { invoke, calls } = cliHarness({
    files: { "/w/.stelow/state/state.md": "current_stage: audit\n" },
    gapState: {
      ...NO_GAPS,
      matched: true,
      totals: { total: 3, fixed: 1, documented: 1, escalated: 1 },
      escalated: [{ description: "checkout ignores promo codes" }],
      auditGapScopes: [
        {
          id: "scope-7",
          name: "handle promo codes",
          status: "in-progress",
          gap: "checkout ignores promo codes",
        },
      ],
    },
  });
  const result = await invoke(["done"]);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /1 audit-gap rework/);
  assert.match(result.stderr, /- handle promo codes \(in-progress\)/);
  assert.deepEqual(
    callsNamed(calls, "updateCard"),
    [],
    "an open rework scope never completes the card",
  );
});

// Regression pin: a SKIPPED rework scope must not keep the card open forever.
// `isSkippedStatus` is the documented done-gate treatment (lib/trackables.mjs:
// "Done-gates treat it as resolved") and lib/completion.mjs's scope gate already
// honors it. This gate used `isDoneStatus` alone, so the only way past it was to
// mark deliberately-set-aside work as `done` — falsely certifying it. The
// sibling test above only covers `in-progress`, which is why that survived.
test("a skipped audit-gap rework scope does not block done", async () => {
  // Built on the full completion fixture so the assertion is exactly the bug:
  // everything else is satisfied, so a skipped rework scope is the ONLY thing
  // that can keep the card from completing.
  const { invoke, calls } = cliHarness(
    auditableBuildDone({
      gapState: {
        ...NO_GAPS,
        matched: true,
        totals: { total: 3, fixed: 1, documented: 1, escalated: 1 },
        escalated: [{ description: "checkout ignores promo codes" }],
        auditGapScopes: [
          {
            id: "scope-7",
            name: "handle promo codes",
            status: "skipped",
            gap: "checkout ignores promo codes",
          },
        ],
      },
    }),
  );
  const result = await invoke(["done"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.doesNotMatch(
    result.stderr ?? "",
    /audit-gap rework/,
    "a skipped rework scope is resolved, not open",
  );
  assert.deepEqual(
    callsNamed(calls, "updateCard").map(([, , fields]) => fields.status),
    ["completed"],
    "a skipped rework scope must not deadlock the card",
  );
});

test("a build done behind an unreadable gap registry still refuses through the depth gate", async () => {
  // A critique that cannot be parsed fails the loop gate with the registry's
  // own refusal, not by silently passing it.
  const { invoke, calls } = cliHarness({
    files: { "/w/.stelow/state/state.md": "current_stage: audit\n" },
    gapState: {
      ...NO_GAPS,
      matched: true,
      failures: ["FAIL critique.md: unparseable gap table"],
    },
  });
  const result = await invoke(["done"]);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /unparseable gap table/);
  assert.deepEqual(callsNamed(calls, "updateCard"), []);
});

test("a build done with depth, linked rework, a recorded test run, and a receipt completes", async () => {
  const { invoke, calls } = cliHarness(auditableBuildDone());
  const result = await invoke(["done"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.match(result.stdout, /Done\. Workflow "checkout" completed at audit\./);
  assert.deepEqual(
    callsNamed(calls, "updateCard").map(([, , fields]) => fields.status),
    ["completed"],
  );
  assert.deepEqual(
    callsNamed(calls, "updateCard").map(([, , fields]) => fields.stage),
    ["audit"],
  );
  assert.deepEqual(callsNamed(calls, "stage").map(([, , stage]) => stage), ["done"]);
  assert.equal(callsNamed(calls, "releaseClaims").length, 1);
});

// A refusal nobody can find is not a refusal the worker can act on. The
// worker reads stderr in its own turn and then the turn ends — the CLI never
// wrote it to the card, so the card's history had no trace of the eight gates
// that turned `done` down. card_hh2nwqs4 parked with ten skipped rework
// scopes and nothing on the card saying so.
//
// One seam around the whole gate chain covers all eight refusals, including
// the two that return a `refuse({…})` object rather than a bare exit code. The
// prefix is what keeps these greppable and distinguishable from worker prose.
test("a refused done leaves the refusal on the card, and a completing one does not", async () => {
  const refused = cliHarness({
    files: { "/w/.stelow/state/state.md": "current_stage: audit\n" },
    docDepths: [
      { label: "Product Spec", path: "docs/spec-product.md", failures: ["no competitor table"] },
    ],
  });
  const refusal = await refused.invoke(["done"]);
  assert.equal(refusal.exitCode, 1);

  const trail = callsNamed(refused.calls, "comment");
  assert.equal(trail.length, 1, "one comment per refused invocation, not one per gate");
  const body = String(trail[0][5]);
  assert.match(body, /^bb stelow done refused: /, "the trail says which command produced it");
  assert.match(body, /no competitor table/, "and carries the gate's own refusal verbatim");

  // The completing path must stay silent: a card whose history says "done was
  // refused" on the turn that completed it is its own kind of lie.
  const accepted = cliHarness(auditableBuildDone());
  assert.equal((await accepted.invoke(["done"])).exitCode, 0);
  assert.deepEqual(
    callsNamed(accepted.calls, "comment"),
    [],
    "a done that completes has nothing to refuse",
  );
});

// `done` reads the card's OWN state and never asks who else is in the
// directory. This is a refusal to add such a gate, pinned as a test because the
// idea is reasonable: a card completing work in a checkout another agent is
// using sounds like a collision worth blocking. It is not — the card that
// would wait has nothing to answer the wait with, no way to know when the
// stranger leaves, and a done gate is the last place a card should acquire a
// dependency on a fact outside its own state. If this ever needs to change,
// the change is a product decision about what completion owes a shared tree,
// not an edit to this file.
test("the done path never consults who else is in the checkout", () => {
  const source = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../server/runtime/cli/cli-done-build.ts"),
    "utf8",
  );
  assert.doesNotMatch(
    source,
    /sharedCheckout|threadsSharingCheckout|listBbThreads|thread list/,
    "done completes a card from its own state; a stranger's presence is not a done gate",
  );
});

/** The harness records the root each helper ran in, because that is part of
 * what an audit trail answers: it samples cwd. A harness that hid the cwd could
 * not see a gate comparing two paths that were never the same checkout — which
 * is the bug this covers.
 *
 * The card's checkout and its project root are two directories whenever the
 * card worked in a worktree — which is the normal case, not the exception.
 * `bb stelow done` refused every such card with "the audit trail attests the
 * repository at <project> but the verified checkout is <worktree>", because the
 * trail was built at the project root while the receipt was verified at the
 * checkout. The gate is right; the path was wrong. */
test("the audit trail is built in the card's checkout, not at the project root", async () => {
  const { invoke, calls } = cliHarness({
    ...auditableBuildDone(),
    workspacePath: "/repo/main",
    checkoutPath: WORKSPACE,
  });
  await invoke(["done"]);
  const builds = callsNamed(calls, "helper").filter(
    ([, args]) => args?.[0] === "audit-trail" && args?.[1] === "build",
  );
  assert.equal(builds.length, 1, "the trail is generated exactly once");
  assert.equal(
    builds[0][2],
    WORKSPACE,
    "built where the receipt was verified, so the two halves of the gate name one checkout",
  );
});

// `doneEligibility` passing is not completion: the frozen technical gate runs
// after eligibility in cli-done-build, and a present-but-junk snapshot opts
// the card into strict evaluation. A done that completed here would prove the
// frozen chain is decorative. The second case pins the documented fail-open:
// no snapshot at all (old cards) still completes.
test("a build done with a frozen snapshot missing its baseline refuses even though eligibility passes", async () => {
  const base = auditableBuildDone();
  const { invoke, calls } = cliHarness({
    ...base,
    files: {
      ...base.files,
      [`/w/.stelow/state/${FROZEN_ACCEPTANCE_FILE}`]: JSON.stringify({
        test_map: [{ test: "node tests/x.test.mjs", criterion: "x works" }],
        red_proof: { failed_command: "node tests/x.test.mjs", exit_code: 1, output_excerpt: "not ok" },
        freeze_sha: "b".repeat(40),
      }),
    },
  });
  const result = await invoke(["done"]);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /\[MissingBaseline\]/);
  assert.deepEqual(
    callsNamed(calls, "updateCard").map(([, , fields]) => fields.status),
    [],
    "a frozen refusal never completes the card",
  );

  const open = cliHarness(auditableBuildDone());
  assert.equal((await open.invoke(["done"])).exitCode, 0, "no snapshot still completes (old-card fail-open)");
});

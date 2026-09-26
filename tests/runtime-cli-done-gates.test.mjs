import assert from "node:assert/strict";
import test from "node:test";
import {
  auditableBuildDone,
  callsNamed,
  cliHarness,
  NO_GAPS,
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

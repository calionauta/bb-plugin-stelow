import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { callsNamed, cliHarness, buildCard, NO_GAPS } from "./helpers/cli-harness.mjs";
import { runScopeCommand } from "../server/scopes.ts";

// Refresh discipline: every host wrapper that mutates tracking or claims
// must publish card-state (and board-changed) so claimed indicators,
// rework scopes, synced scopes, and transitions flip on the card without
// waiting for the next lifecycle event. Check is the only exemption
// (read-only).
//
// Each wrapper is DRIVEN through the real dispatcher, and the publish calls it
// makes are what is asserted: a wrapper that dropped its refresh fails here,
// where a source pin would have passed on the dead line.

function publishedEvents(calls) {
  return callsNamed(calls, "publish").map(([, event]) => event);
}

test("sync-scopes refreshes the card and the board it wrote to", async () => {
  const { invoke, calls } = cliHarness({ helper: { code: 0, stdout: "synced", stderr: "" } });
  assert.equal((await invoke(["sync-scopes"])).exitCode, 0);
  assert.deepEqual(publishedEvents(calls), ["card-state", "board-changed"]);
});

test("gap-scopes refreshes the card and the board when it converts gaps", async () => {
  const dir = mkdtempSync(join(tmpdir(), "stelow-refresh-gap-"));
  writeFileSync(
    join(dir, "stelow.json"),
    JSON.stringify({ workflows: [{ workflowId: "card_1", scopes: [], rework_rounds: 0 }] }),
  );
  try {
    const { invoke, calls } = cliHarness({
      workspacePath: dir,
      gapState: {
        ...NO_GAPS,
        matched: true,
        totals: { total: 1, fixed: 0, documented: 0, escalated: 1 },
        escalated: [{ description: "promo codes ignored" }],
      },
    });
    assert.equal((await invoke(["gap-scopes"])).exitCode, 0);
    assert.deepEqual(publishedEvents(calls), ["card-state", "board-changed"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("lock refreshes only on a successful mutating op; check stays silent", async () => {
  const acquire = cliHarness({ helper: { code: 0, stdout: "locked", stderr: "" } });
  await acquire.invoke(["lock", "acquire", "--scope", "scope-1"]);
  assert.deepEqual(
    publishedEvents(acquire.calls),
    ["card-state", "board-changed"],
    "a successful acquire flips the claimed indicators",
  );

  const check = cliHarness({ helper: { code: 0, stdout: "ok", stderr: "" } });
  await check.invoke(["lock", "check", "--scope", "scope-1"]);
  assert.deepEqual(publishedEvents(check.calls), [], "check is read-only");

  const failed = cliHarness({ helper: { code: 1, stdout: "", stderr: "held" } });
  const failedResult = await failed.invoke(["lock", "acquire", "--scope", "scope-1"]);
  assert.equal(failedResult.exitCode, 1);
  assert.deepEqual(publishedEvents(failed.calls), [], "a refused lock mutates nothing to refresh");
});

test("split refreshes the parent card and the board it changed", async () => {
  const { invoke, calls } = cliHarness({
    card: buildCard({ stage: "triage" }),
    rows: {
      split_proposals: {
        slices: JSON.stringify([
          { title: "A", desc: "slice a" },
          { title: "B", desc: "slice b" },
        ]),
        selected: JSON.stringify(["A"]),
        asked_at: Date.now(),
        consumed_at: null,
        created: "[]",
      },
    },
  });
  assert.equal((await invoke(["split"])).exitCode, 0);
  const events = publishedEvents(calls);
  assert.ok(events.includes("card-state"), "the parent card is refreshed");
  assert.ok(events.includes("board-changed"), "and the board list the split extended");
});

test("scope is delegated to its own family, whose transitions refresh", async () => {
  const delegated = cliHarness();
  await delegated.invoke(["scope", "start", "--scope", "scope-1"]);
  assert.equal(
    callsNamed(delegated.calls, "scopeCommand").length,
    1,
    "the passthrough family hands scope to the extracted module",
  );

  // The module itself, driven: a committed transition publishes both surfaces.
  const events = [];
  const deps = {
    bb: { realtime: { publish: (name) => events.push(name) } },
    getCardByWorkerThread: () => ({ id: "card_1", dir_hash: "hash1" }),
    cardWorkspace: async () => ({ path: "/w" }),
    projectRoot: async () => "/w",
    workflowStateDir: async () => "/w/.stelow/state",
    ensureProjectArtifacts: async () => null,
    runHelper: async () => ({ code: 0, stdout: "ok", stderr: "" }),
    recordTrackableEvent: () => {},
  };
  const result = await runScopeCommand(
    ["scope", "start", "--scope", "scope-1"],
    { threadId: "thr_worker" },
    deps,
  );
  assert.equal(result.exitCode, 0);
  assert.deepEqual(events, ["card-state", "board-changed"], "scope refreshes the card and the board");
});

console.log("refresh discipline test ok: mutating wrappers publish, check stays silent");

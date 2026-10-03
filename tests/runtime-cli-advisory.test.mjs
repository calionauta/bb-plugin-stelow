import assert from "node:assert/strict";
import test from "node:test";
import { buildCard, callsNamed, cliHarness } from "./helpers/cli-harness.mjs";

/** The advisory judges (criteria, verify-tasks, verify-delegation,
 * gap-triage): read-only, routed through one decision point, and never a
 * gate. */

const API_ROUTER = {
  decision_points: {
    mode: "api",
    thresholds: "{}",
    provider: null,
    endpoint: null,
    api_key: null,
    model: null,
    preset_id: null,
  },
  decision_api_config: {
    endpoint: "",
    api_key: "stored-key",
    model: "",
    provider: null,
  },
};

test("gap-triage runs only on Build cards", async () => {
  const { invoke, calls } = cliHarness({ card: buildCard({ kind: "research" }) });
  const result = await invoke(["gap-triage"]);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /gap-triage runs on Build cards/);
  assert.deepEqual(callsNamed(calls, "judgeScoredBatch"), []);
});

test("gap-triage refuses an unmatched critique before judging", async () => {
  const { invoke, calls } = cliHarness();
  const result = await invoke(["gap-triage"]);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /No execution critique found/);
  assert.deepEqual(callsNamed(calls, "judgeScoredBatch"), []);
});

test("verify --tests records the run against the observed Git identity", async () => {
  const { invoke, calls } = cliHarness({
    testCommand: { command: "npm", args: ["test"], display: "npm test" },
    hostTests: { exitCode: 0, output: "3 passing" },
  });
  const result = await invoke(["verify", "--tests"]);
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /PASS: npm test recorded at a{40}/);
  const insert = calls.find(([entry, sql]) => entry === "run" && sql.includes("verification_runs"));
  assert.ok(insert, "the run is recorded for the completion gate");
  assert.equal(insert[2][2], "npm test");
  assert.equal(insert[2][3], "/w");
});

// Regression pin: a SKIPPED rework scope is resolved, not open. `verify`
// warned "rework loop open ... finish it" for scopes that were deliberately
// set aside, naming work as unfinished that the card had already closed out.
// Same rule the done gate applies (lib/trackables.mjs: skipped is "explicitly
// set aside", and done-gates treat it as resolved).
test("verify does not warn that a skipped rework scope is open", async () => {
  const { invoke } = cliHarness({
    testCommand: { command: "npm", args: ["test"], display: "npm test" },
    hostTests: { exitCode: 0, output: "3 passing" },
    gapState: {
      matched: true,
      failures: [],
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
  });
  const result = await invoke(["verify", "--tests"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.doesNotMatch(
    `${result.stdout}${result.stderr}`,
    /rework loop open/,
    "a skipped rework scope is resolved, not open",
  );
});

test("verify warns that documented debt past its expires date will block done", async () => {
  const { invoke } = cliHarness({
    testCommand: { command: "npm", args: ["test"], display: "npm test" },
    hostTests: { exitCode: 0, output: "3 passing" },
    gapState: {
      matched: true,
      failures: [],
      totals: { total: 1, fixed: 0, documented: 1, escalated: 0 },
      gaps: [
        { description: "Rename helper", resolution: "documented", evidence: null, expires: "2023-01-01", owner: "ana" },
      ],
      escalated: [],
      auditGapScopes: [],
    },
  });
  const result = await invoke(["verify", "--tests"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.match(
    `${result.stdout}${result.stderr}`,
    /EXPIRED Rename helper \(past 2023-01-01\) — re-scope, re-date with an owner, or fix inline/,
    "expired debt warns with its exits before done refuses",
  );
});

test("verify stays silent for documented debt dated in the future", async () => {
  const { invoke } = cliHarness({
    testCommand: { command: "npm", args: ["test"], display: "npm test" },
    hostTests: { exitCode: 0, output: "3 passing" },
    gapState: {
      matched: true,
      failures: [],
      totals: { total: 1, fixed: 0, documented: 1, escalated: 0 },
      gaps: [
        { description: "Rename helper", resolution: "documented", evidence: null, expires: "2099-01-01", owner: "ana" },
      ],
      escalated: [],
      auditGapScopes: [],
    },
  });
  const result = await invoke(["verify", "--tests"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.doesNotMatch(
    `${result.stdout}${result.stderr}`,
    /rework loop open/,
    "settled debt warns nothing",
  );
});

test("verify --tests refuses a checkout with no conventional test command", async () => {
  const { invoke, calls } = cliHarness({ testCommand: null });
  const result = await invoke(["verify", "--tests"]);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /No safe conventional test command/);
  assert.deepEqual(
    calls.filter(([entry, sql]) => entry === "run" && sql.includes("verification_runs")),
    [],
    "a refused run records nothing",
  );
});

test("verify on a Build card without --tests names the missing flag", async () => {
  const { invoke } = cliHarness();
  const result = await invoke(["verify"]);
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /Build verification requires --tests/);
});

test("verify-tasks reports a clean board as openly pending, not as a pass", async () => {
  const { invoke, calls } = cliHarness({ rows: API_ROUTER });
  const result = await invoke(["verify-tasks"]);
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /No completed tasks to evidence/);
  assert.deepEqual(callsNamed(calls, "judgeScoredBatch"), []);
});

test("verify-delegation without a worker thread says nothing to inspect", async () => {
  const { invoke } = cliHarness({ card: buildCard({ worker_thread_id: null }) });
  const result = await invoke(["verify-delegation", "--card", "card_1"]);
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /No worker thread/);
});

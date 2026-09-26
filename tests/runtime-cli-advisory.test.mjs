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

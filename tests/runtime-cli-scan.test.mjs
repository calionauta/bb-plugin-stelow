import assert from "node:assert/strict";
import test from "node:test";
import {
  auditableBuildDone,
  buildCard,
  callsNamed,
  cliHarness,
} from "./helpers/cli-harness.mjs";

/** The scan CLI and its done gate: a recorded clean report completes,
 * anything else names the fix. The regression this pins is the silent
 * pass — a card whose scan never ran reading as secure. */

const CLEAN_REPORT = JSON.stringify({
  scanners: [{ name: "semgrep", ran: true }],
  findings: [],
});

const FAILED_REPORT = JSON.stringify({
  scanners: [{ name: "semgrep", ran: true }],
  findings: [{ severity: "high", rule: "sql-injection", file: "db.js", line: 41 }],
});

function scanInsert(calls) {
  return calls.find(([entry, sql]) => entry === "run" && String(sql).includes("scan_runs"));
}

test("scan records a clean report with exit 0 against the observed HEAD", async () => {
  const { invoke, calls } = cliHarness({ files: { "/w/report.json": CLEAN_REPORT } });
  const result = await invoke(["scan", "--report", "/w/report.json"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.match(result.stdout, /^PASS  scan clean \(0 finding\(s\) below threshold\)/);
  const insert = scanInsert(calls);
  assert.ok(insert, "the scan verdict is recorded for the completion gate");
  assert.equal(insert[2][5], 0);
  assert.equal(insert[2][4], "a".repeat(40));
});

test("scan reports findings with exit 1 and still records the run", async () => {
  const { invoke, calls } = cliHarness({ files: { "/w/report.json": FAILED_REPORT } });
  const result = await invoke(["scan", "--report", "/w/report.json"]);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /^FAIL  1 finding\(s\) at threshold or above.*sql-injection/);
  assert.ok(scanInsert(calls), "a failed scan records so done keeps refusing on evidence");
});

test("scan of a missing report is did-not-run (exit 2), never clean", async () => {
  const { invoke, calls } = cliHarness({});
  const result = await invoke(["scan", "--report", "/w/nope.json"]);
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /^DID-NOT-RUN  coverage incomplete/);
  const insert = scanInsert(calls);
  assert.ok(insert, "the missing scan records so done refuses instead of passing silent");
  assert.equal(insert[2][5], 2);
});

test("scan refuses a report below the required scanners as did-not-run", async () => {
  const { invoke } = cliHarness({ files: { "/w/report.json": CLEAN_REPORT } });
  const result = await invoke(["scan", "--report", "/w/report.json", "--require-scanners", "semgrep,trivy"]);
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /trivy did not run/);
});

test("scan refuses exploratory workspaces and records nothing", async () => {
  const { invoke, calls } = cliHarness({ card: buildCard({ workspace_kind: "exploratory" }) });
  const result = await invoke(["scan", "--report", "/w/report.json"]);
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /recovery audit/);
  assert.deepEqual(
    calls.filter(([entry, sql]) => entry === "run" && String(sql).includes("scan_runs")),
    [],
    "a refused exploratory scan records nothing",
  );
});

test("scan refuses an unknown format as usage and records nothing", async () => {
  const { invoke, calls } = cliHarness({ files: { "/w/report.json": CLEAN_REPORT } });
  const result = await invoke(["scan", "--report", "/w/report.json", "--format", "bogus"]);
  assert.equal(result.exitCode, 2);
  assert.deepEqual(
    calls.filter(([entry, sql]) => entry === "run" && String(sql).includes("scan_runs")),
    [],
    "a usage refusal is a caller error, not scan evidence",
  );
});

test("scan matches required scanners case-insensitively and reads string rosters", async () => {
  const { invoke } = cliHarness({
    files: { "/w/report.json": JSON.stringify({ scanners: ["Semgrep"], findings: [] }) },
  });
  const result = await invoke(["scan", "--report", "/w/report.json", "--require-scanners", "SEMGREP"]);
  assert.equal(result.exitCode, 0, result.stderr);
});

test("scan resolves a checkout-relative report and answers --json on stdout", async () => {
  const { invoke, calls } = cliHarness({ files: { "/w/report.json": FAILED_REPORT } });
  const result = await invoke(["scan", "--report", "report.json", "--format", "neutral", "--json"]);
  assert.equal(result.exitCode, 1);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.status, "failed");
  assert.equal(payload.overThreshold.length, 1);
  assert.ok(calls.some(([entry]) => entry === "read"), "the report is read through the host files seam");
});
test("scan refuses without a report path and outside Build cards", async () => {
  const { invoke } = cliHarness({});
  const missing = await invoke(["scan"]);
  assert.equal(missing.exitCode, 2);
  const research = cliHarness({ card: buildCard({ kind: "research" }) });
  const refused = await research.invoke(["scan", "--report", "/w/report.json"]);
  assert.equal(refused.exitCode, 2);
  assert.match(refused.stderr, /Build/);
});

test("done completes only with a recorded clean scan at this HEAD", async () => {
  const accepted = cliHarness(auditableBuildDone());
  const ok = await accepted.invoke(["done"]);
  assert.equal(ok.exitCode, 0, ok.stderr);

  const base = auditableBuildDone();
  const { rows: _dropped, ...withoutScan } = base;
  void _dropped;
  const refused = cliHarness({
    ...withoutScan,
    rows: { verification_runs: base.rows.verification_runs },
  });
  const result = await refused.invoke(["done"]);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /No passing security scan/);
  assert.deepEqual(
    callsNamed(refused.calls, "updateCard"),
    [],
    "a card whose scan never ran never completes",
  );
});

test("done refuses a failing scan and a stale HEAD", async () => {
  const base = auditableBuildDone();
  const failing = cliHarness({
    ...base,
    rows: {
      ...base.rows,
      scan_runs: { ...base.rows.scan_runs, exit_code: 1 },
    },
  });
  const failed = await failing.invoke(["done"]);
  assert.equal(failed.exitCode, 1);
  assert.match(failed.stderr, /findings at or above the threshold/);

  const stale = cliHarness({
    ...base,
    rows: {
      ...base.rows,
      scan_runs: { ...base.rows.scan_runs, head_sha: "b".repeat(40) },
    },
  });
  const moved = await stale.invoke(["done"]);
  assert.equal(moved.exitCode, 1);
  assert.match(moved.stderr, /different checkout or HEAD/);

  const storedDidNotRun = cliHarness({
    ...base,
    rows: {
      ...base.rows,
      scan_runs: { ...base.rows.scan_runs, exit_code: 2 },
    },
  });
  const recorded = await storedDidNotRun.invoke(["done"]);
  assert.equal(recorded.exitCode, 1);
  assert.match(recorded.stderr, /did not run is not a clean scan/);
  assert.doesNotMatch(recorded.stderr, /threshold/, "a did-not-run refusal never blames findings");
});

test("verify warns on failing and stale scans but still passes the tests", async () => {
  const failing = cliHarness({
    testCommand: { command: "npm", args: ["test"], display: "npm test" },
    hostTests: { exitCode: 0, output: "3 passing" },
    rows: { scan_runs: { scanners: "[]", git_root: "/w", head_sha: "a".repeat(40), exit_code: 1 } },
  });
  const failed = await failing.invoke(["verify", "--tests"]);
  assert.equal(failed.exitCode, 0, failed.stderr);
  assert.match(`${failed.stdout}${failed.stderr}`, /SCANFAILED/, "a failing scan warns, never blocks verify");

  const stale = cliHarness({
    testCommand: { command: "npm", args: ["test"], display: "npm test" },
    hostTests: { exitCode: 0, output: "3 passing" },
    rows: { scan_runs: { scanners: "[]", git_root: "/w", head_sha: "b".repeat(40), exit_code: 0 } },
  });
  const moved = await stale.invoke(["verify", "--tests"]);
  assert.equal(moved.exitCode, 0, moved.stderr);
  assert.match(`${moved.stdout}${moved.stderr}`, /SCANSTALE/, "a stale scan warns, never blocks verify");
});
test("verify warns that a missing scan will block done but still passes the tests", async () => {
  const { invoke } = cliHarness({
    testCommand: { command: "npm", args: ["test"], display: "npm test" },
    hostTests: { exitCode: 0, output: "3 passing" },
  });
  const result = await invoke(["verify", "--tests"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.match(
    `${result.stdout}${result.stderr}`,
    /security scan open/,
    "the missing scan warns with its exit before done refuses",
  );
});

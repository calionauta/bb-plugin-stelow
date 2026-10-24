import assert from "node:assert/strict";
import test from "node:test";
import { scanReadiness } from "../lib/audit-verification.mjs";
import {
  exitCodeForScan,
  normalizeSeverity,
  parseNeutral,
  parseReport,
  parseSarif,
  renderScanLine,
  renderScanSummary,
  summarizeScan,
} from "../lib/scan-contract.mjs";

/** The tri-state contract: clean (0), failed (1), did-not-run (2). The
 * load-bearing rule is the third state — an empty finding list with
 * incomplete coverage must never read as clean. */

const HEAD = "a".repeat(40);
const EVIDENCE = { gitRoot: "/w", headSha: HEAD };

test("a neutral report with no findings and a ran scanner is clean", () => {
  const summary = summarizeScan({
    report: parseNeutral(JSON.stringify({
      scanners: [{ name: "semgrep", ran: true }],
      findings: [],
    })),
  });
  assert.equal(summary.status, "clean");
  assert.equal(summary.exitCode, 0);
  assert.equal(exitCodeForScan(summary), 0);
});

test("a neutral report with a high finding fails", () => {
  const summary = summarizeScan({
    report: parseNeutral(JSON.stringify({
      scanners: [{ name: "semgrep", ran: true }],
      findings: [{ severity: "high", rule: "sql-injection", file: "db.js", line: 41 }],
    })),
  });
  assert.equal(summary.status, "failed");
  assert.equal(summary.exitCode, 1);
  assert.equal(summary.overThreshold.length, 1);
  assert.match(renderScanLine(summary), /FAIL.*sql-injection.*db\.js:41/);
  assert.match(renderScanSummary(summary), /FAILED/);
});

test("a finding below the threshold stays clean", () => {
  const summary = summarizeScan({
    report: { scanners: [{ name: "semgrep", ran: true }], findings: [{ severity: "low", rule: "todo" }] },
  });
  assert.equal(summary.status, "clean");
});

test("a medium threshold fails on medium and passes on low", () => {
  const medium = summarizeScan({
    report: { scanners: [], findings: [{ severity: "medium", rule: "m" }] },
    failOn: "medium",
  });
  assert.equal(medium.status, "failed");
  const low = summarizeScan({
    report: { scanners: [], findings: [{ severity: "low", rule: "l" }] },
    failOn: "medium",
  });
  assert.equal(low.status, "clean");
});

test("an empty finding list with a missing required scanner is did-not-run, not clean", () => {
  const summary = summarizeScan({
    report: { scanners: [{ name: "semgrep", ran: true }], findings: [] },
    requireScanners: "semgrep,trivy",
  });
  assert.equal(summary.status, "did-not-run");
  assert.equal(summary.exitCode, 2);
  assert.deepEqual(summary.missing, ["trivy"]);
  assert.match(renderScanLine(summary), /DID-NOT-RUN.*trivy did not run/);
  assert.match(renderScanSummary(summary), /DID-NOT-RUN.*not a clean scan/);
});

test("a scanner entry that did not run counts as missing", () => {
  const summary = summarizeScan({
    report: parseNeutral(JSON.stringify({
      scanners: [{ name: "trivy", ran: false }],
      findings: [],
    })),
    requireScanners: "trivy",
  });
  assert.equal(summary.status, "did-not-run");
});

test("an unreadable or unknown report is did-not-run", () => {
  for (const report of [null, undefined, parseNeutral("not json"), parseNeutral("{}")]) {
    const summary = summarizeScan({ report, requireScanners: "semgrep" });
    assert.equal(summary.status, "did-not-run", `report ${String(report)} must not read clean`);
    assert.equal(summary.exitCode, 2);
  }
});

test("a SARIF report with an error-level result fails and names the scanner", () => {
  const sarif = {
    version: "2.1.0",
    runs: [{
      tool: { driver: { name: "CodeQL" } },
      results: [{
        ruleId: "js/sql-injection",
        level: "error",
        locations: [{ physicalLocation: { artifactLocation: { uri: "db.js" }, region: { startLine: 41 } } }],
      }],
    }],
  };
  const report = parseReport(JSON.stringify(sarif));
  assert.equal(report.scanners[0].name, "CodeQL");
  const summary = summarizeScan({ report });
  assert.equal(summary.status, "failed");
  assert.match(renderScanLine(summary), /js\/sql-injection.*db\.js:41/);
});

test("a SARIF run whose invocation failed counts as did-not-run", () => {
  const report = parseSarif({
    version: "2.1.0",
    runs: [{
      tool: { driver: { name: "semgrep" } },
      invocations: [{ executionSuccessful: false }],
      results: [],
    }],
  });
  const summary = summarizeScan({ report, requireScanners: "semgrep" });
  assert.equal(summary.status, "did-not-run");
});

test("auto format reads SARIF shape first and neutral otherwise", () => {
  const sarifLike = parseReport(JSON.stringify({ version: "2.1.0", runs: [{ tool: { driver: {} }, results: [] }] }), "auto");
  assert.equal(sarifLike.scanners.length, 1);
  const neutral = parseReport(JSON.stringify({ scanners: ["semgrep"], findings: [] }), "auto");
  assert.equal(neutral.scanners[0].name, "semgrep");
  assert.equal(parseReport("garbage", "auto"), null);
});

test("an unknown severity never vanishes into clean", () => {
  const neutral = summarizeScan({
    report: parseNeutral(JSON.stringify({
      scanners: [{ name: "semgrep", ran: true }],
      findings: [{ severity: "bogus", rule: "mystery" }],
    })),
  });
  assert.equal(neutral.status, "failed", "neutral fail-closes unknown severities to high");
  const direct = summarizeScan({
    report: { scanners: [], findings: [{ severity: null }] },
  });
  assert.equal(direct.status, "failed", "direct reports fail-close too");
});

test("auto merge never masks findings behind the first parser", () => {
  const hybrid = JSON.stringify({
    runs: [{ tool: { driver: {} }, results: [] }],
    scanners: ["other"],
    findings: [{ severity: "high", rule: "x" }],
  });
  const report = parseReport(hybrid, "auto");
  assert.equal(report.findings.length, 1);
  assert.equal(summarizeScan({ report }).status, "failed");
});

test("a report naming zero scanners proves nothing, but findings still fail", () => {
  const empty = summarizeScan({
    report: parseNeutral(JSON.stringify({ findings: [] })),
  });
  assert.equal(empty.status, "did-not-run", "no scanner named and no findings: nothing proven");
  const lowOnly = summarizeScan({
    report: parseNeutral(JSON.stringify({ findings: [{ severity: "low", rule: "l" }] })),
  });
  assert.equal(lowOnly.status, "clean", "findings below threshold with no roster: known limit, use --require-scanners");
  const highOnly = summarizeScan({
    report: parseNeutral(JSON.stringify({ findings: [{ severity: "high", rule: "h" }] })),
  });
  assert.equal(highOnly.status, "failed", "a named finding fails even when no scanner is named");
});
test("severity normalization maps platform words without inventing ranks", () => {
  assert.equal(normalizeSeverity("HIGH"), "high");
  assert.equal(normalizeSeverity("error"), "high");
  assert.equal(normalizeSeverity("warning"), "medium");
  assert.equal(normalizeSeverity("bogus"), null);
});

test("scanReadiness accepts only a recorded clean run at the audited HEAD", () => {
  const clean = { exit_code: 0, git_root: "/w", head_sha: HEAD };
  assert.equal(scanReadiness(clean, EVIDENCE).ready, true);
  const missing = scanReadiness(undefined, EVIDENCE);
  assert.equal(missing.ready, false);
  assert.equal(missing.code, "ScanMissing");
  assert.match(missing.error, /did not run is not a clean scan/);
  const failed = scanReadiness({ ...clean, exit_code: 1 }, EVIDENCE);
  assert.equal(failed.ready, false);
  assert.equal(failed.code, "ScanFailed");
  const stale = scanReadiness({ ...clean, head_sha: "b".repeat(40) }, EVIDENCE);
  assert.equal(stale.ready, false);
  assert.equal(stale.code, "ScanStale");
  assert.match(stale.error, /different checkout or HEAD/);
  const didNotRun = scanReadiness({ ...clean, exit_code: 2 }, EVIDENCE);
  assert.equal(didNotRun.ready, false);
  assert.equal(didNotRun.code, "ScanMissing");
  assert.match(didNotRun.error, /did not run is not a clean scan/);
});

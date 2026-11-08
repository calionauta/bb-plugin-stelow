/**
 * Tri-state security scan contract (pure, no I/O).
 *
 * A scan that did not run is not a clean scan: every verdict is one of
 * clean (0), failed (1), or did-not-run (2). A missing report, an unknown
 * format, or incomplete coverage never reads as clean — it reads as
 * did-not-run, and the done gate refuses it exactly like a failure.
 *
 * Mirrors lib/audit-gate.mjs: fail-closed verdicts, skips carried through
 * rather than folded into ok, one printed line per result.
 */

export const SCAN_EXIT = Object.freeze({ CLEAN: 0, FAILED: 1, DID_NOT_RUN: 2 });

const SEVERITY_RANK = Object.freeze({ critical: 4, high: 3, medium: 2, low: 1 });

/** Normalize a severity word to critical|high|medium|low. Null when unknown. */
export function normalizeSeverity(value) {
  if (typeof value !== "string") return null;
  const word = value.trim().toLowerCase();
  if (word in SEVERITY_RANK) return word;
  if (word === "error") return "high";
  if (word === "warning") return "medium";
  if (word === "note" || word === "none" || word === "info") return "low";
  return null;
}

function rankOf(severity) {
  return SEVERITY_RANK[severity] ?? 0;
}

function str(value) {
  return typeof value === "string" ? value : "";
}

function sarifLocationUri(result) {
  try {
    const locations = result?.locations;
    const first = Array.isArray(locations) ? locations[0] : null;
    const uri = first?.physicalLocation?.artifactLocation?.uri;
    return typeof uri === "string" ? uri : "";
  } catch {
    return "";
  }
}

function sarifLocationLine(result) {
  try {
    const region = result?.locations?.[0]?.physicalLocation?.region;
    return Number.isInteger(region?.startLine) ? region.startLine : null;
  } catch {
    return null;
  }
}

/**
 * Parse a SARIF 2.1.0 report into { scanners, findings }. Each run is one
 * scanner entry; a run whose invocation reports executionSuccessful: false
 * reads as not-ran. Null on any misshape — callers treat that as did-not-run.
 */
export function parseSarif(content) {
  let parsed;
  try {
    parsed = typeof content === "string" ? JSON.parse(content) : content;
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const runs = parsed.runs;
  if (!Array.isArray(runs) || runs.length === 0) return null;
  const scanners = [];
  const findings = [];
  for (const run of runs) {
    if (!run || typeof run !== "object") return null;
    const name = str(run?.tool?.driver?.name).trim() || "sarif";
    const invocations = Array.isArray(run.invocations) ? run.invocations : [];
    const ran = invocations.length === 0
      ? true
      : invocations.every((inv) => inv?.executionSuccessful !== false);
    scanners.push({ name, ran });
    const results = Array.isArray(run.results) ? run.results : [];
    for (const result of results) {
      if (!result || typeof result !== "object") continue;
      const severity = normalizeSeverity(result.level) ?? "high";
      findings.push({
        severity,
        rule: str(result.ruleId).trim(),
        file: sarifLocationUri(result),
        line: sarifLocationLine(result),
      });
    }
  }
  return { scanners, findings };
}

function parseScannerEntry(entry) {
  if (typeof entry === "string" && entry.trim()) return { name: entry.trim(), ran: true };
  if (entry && typeof entry === "object" && !Array.isArray(entry)) {
    const name = str(entry.name ?? entry.scanner).trim();
    if (!name) return null;
    return { name, ran: entry.ran !== false && entry.executionSuccessful !== false };
  }
  return null;
}

/**
 * Parse the neutral format: { scanners, findings }. Scanners may be names
 * or { name, ran } rows; findings carry severity plus optional rule/file.
 * Null when neither field yields anything usable.
 */
export function parseNeutral(content) {
  let parsed;
  try {
    parsed = typeof content === "string" ? JSON.parse(content) : content;
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const rawScanners = Array.isArray(parsed.scanners) ? parsed.scanners : [];
  const rawFindings = Array.isArray(parsed.findings) ? parsed.findings : [];
  const scanners = rawScanners.map(parseScannerEntry).filter(Boolean);
  const findings = [];
  for (const entry of rawFindings) {
    if (!entry || typeof entry !== "object") continue;
    // Fail-closed: an unreadable severity never vanishes into clean — it
    // reads as high, the same default the SARIF parser applies.
    const severity = normalizeSeverity(entry.severity ?? entry.level) ?? "high";
    findings.push({
      severity,
      rule: str(entry.rule ?? entry.ruleId).trim(),
      file: str(entry.file ?? entry.path).trim(),
      line: Number.isInteger(entry.line) ? entry.line : null,
    });
  }
  if (scanners.length === 0 && findings.length === 0) return null;
  return { scanners, findings };
}

/** Parse a report body. Format auto|sarif|neutral; auto merges both shapes
 * so a hybrid envelope can never mask findings behind the first parser
 * that succeeds. */
export function parseReport(content, format = "auto") {
  if (format === "sarif") return parseSarif(content);
  if (format === "neutral") return parseNeutral(content);
  const sarif = parseSarif(content);
  const neutral = parseNeutral(content);
  if (sarif && neutral) {
    return { scanners: [...sarif.scanners, ...neutral.scanners], findings: [...sarif.findings, ...neutral.findings] };
  }
  return sarif ?? neutral;
}

function requiredList(value) {
  if (Array.isArray(value)) return value.map((entry) => str(entry).trim().toLowerCase()).filter(Boolean);
  if (typeof value === "string" && value.trim()) {
    return value.split(",").map((entry) => entry.trim().toLowerCase()).filter(Boolean);
  }
  return [];
}

/**
 * The verdict over a parsed report. Fail-closed: a null report, an empty
 * scanner roster under --require-scanners, or any required scanner without
 * a ran entry counts as did-not-run, never as clean.
 */
export function summarizeScan({ report = null, failOn = "high", requireScanners = [] } = {}) {
  const threshold = normalizeSeverity(failOn) ?? "high";
  const required = requiredList(requireScanners);
  if (!report || typeof report !== "object") {
    return {
      status: "did-not-run",
      exitCode: SCAN_EXIT.DID_NOT_RUN,
      overThreshold: [],
      missing: [...required],
      findingsCount: 0,
      scanners: [],
    };
  }
  const scanners = Array.isArray(report.scanners) ? report.scanners : [];
  const rawFindings = Array.isArray(report.findings) ? report.findings : [];
  // Defensive: a finding smuggled past the parsers with an unknown severity
  // ranks high, never below the threshold into clean.
  const findings = rawFindings.map((finding) => ({
    ...finding,
    severity: normalizeSeverity(finding?.severity) ?? "high",
  }));
  const ranByName = new Map();
  for (const scanner of scanners) {
    if (!scanner || typeof scanner.name !== "string") continue;
    const key = scanner.name.trim().toLowerCase();
    if (!key) continue;
    ranByName.set(key, (ranByName.get(key) ?? false) || scanner.ran !== false);
  }
  const missing = required.filter((name) => ranByName.get(name) !== true);
  const overThreshold = findings.filter((finding) => rankOf(finding.severity) >= rankOf(threshold));
  if (missing.length > 0) {
    return { status: "did-not-run", exitCode: SCAN_EXIT.DID_NOT_RUN, overThreshold, missing, findingsCount: findings.length, scanners };
  }
  if (overThreshold.length > 0) {
    return { status: "failed", exitCode: SCAN_EXIT.FAILED, overThreshold, missing, findingsCount: findings.length, scanners };
  }
  return { status: "clean", exitCode: SCAN_EXIT.CLEAN, overThreshold, missing, findingsCount: findings.length, scanners };
}

/** Exit code for a summary: 0 clean, 1 failed, anything else did-not-run. */
export function exitCodeForScan(summary) {
  if (summary?.status === "clean") return SCAN_EXIT.CLEAN;
  if (summary?.status === "failed") return SCAN_EXIT.FAILED;
  return SCAN_EXIT.DID_NOT_RUN;
}

/** One printed line for the verdict, aligned with the audit-gate style. */
export function renderScanLine(summary) {
  const over = summary?.overThreshold ?? [];
  if (summary?.status === "clean") {
    const count = summary.findingsCount ?? 0;
    return `PASS  scan clean (${count} finding(s) below threshold)`;
  }
  if (summary?.status === "failed") {
    const first = over.slice(0, 3).map((finding) => {
      const where = finding.file ? ` ${finding.file}${finding.line ? `:${finding.line}` : ""}` : "";
      return `[${finding.severity}] ${finding.rule || "finding"}${where}`;
    }).join("; ");
    const tail = first ? `: ${first}${over.length > 3 ? "…" : ""}` : "";
    return `FAIL  ${over.length} finding(s) at threshold or above${tail}`;
  }
  const missing = summary?.missing ?? [];
  const why = missing.length > 0
    ? `: ${missing.join(", ")} did not run`
    : " — report missing, unreadable, or of unknown format";
  return `DID-NOT-RUN  coverage incomplete${why}`;
}

/** Closing line: green only when nothing was skipped or missing. */
export function renderScanSummary(summary) {
  if (summary?.status === "clean") return `scan: CLEAN — ${summary.findingsCount ?? 0} finding(s) below threshold`;
  if (summary?.status === "failed") {
    return `scan: FAILED — ${(summary.overThreshold ?? []).length} finding(s) at threshold or above`;
  }
  return `scan: DID-NOT-RUN — a scan that did not run is not a clean scan`;
}

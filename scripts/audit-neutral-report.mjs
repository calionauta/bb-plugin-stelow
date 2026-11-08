#!/usr/bin/env node
/**
 * Turn `npm audit --json` into the neutral security report `bb stelow scan`
 * reads: `{ scanners: [{name, ran}], findings: [{severity, rule, file}] }`.
 *
 * Only scanners that actually ran are named. `npm audit` is a real scanner of
 * the dependency tree, and claiming anything else ran would be the "a scan that
 * did not run is not a clean scan" failure the contract refuses.
 *
 * Usage: node scripts/audit-neutral-report.mjs --dir <checkout> --out <path>
 */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const args = process.argv.slice(2);
const dirAt = args.indexOf("--dir");
const outAt = args.indexOf("--out");
if (dirAt < 0 || outAt < 0) {
  console.error("Usage: node scripts/audit-neutral-report.mjs --dir <checkout> --out <path>");
  process.exit(2);
}
const dir = resolve(args[dirAt + 1]);
const out = resolve(args[outAt + 1]);

let audit = null;
try {
  // `npm audit` exits non-zero when it finds vulnerabilities; the JSON body is
  // still the report, so the exit code carries no extra meaning here.
  const stdout = execFileSync("npm", ["audit", "--json"], {
    cwd: dir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  audit = JSON.parse(stdout);
} catch (error) {
  if (typeof error.stdout === "string" && error.stdout.trim()) {
    try {
      audit = JSON.parse(error.stdout);
    } catch {
      audit = null;
    }
  }
}

const findings = [];
if (audit?.vulnerabilities && typeof audit.vulnerabilities === "object") {
  for (const [name, entry] of Object.entries(audit.vulnerabilities)) {
    const severity = String(entry?.severity ?? "high");
    const titles = Array.isArray(entry?.via)
      ? entry.via
        .filter((via) => via && typeof via === "object")
        .map((via) => String(via.title ?? via.name ?? "").trim())
        .filter(Boolean)
      : [];
    findings.push({
      severity,
      rule: `npm-audit:${name}`,
      file: "package-lock.json",
      line: null,
      detail: titles.join("; "),
    });
  }
}

writeFileSync(out, JSON.stringify({
  // `ran: false` when npm itself failed to answer — a scanner that did not run
  // must not read as clean.
  scanners: [{ name: "npm-audit", ran: audit !== null }],
  findings,
}, null, 2) + "\n");
console.log(`${findings.length} finding(s) -> ${out}`);

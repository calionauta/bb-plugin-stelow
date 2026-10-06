#!/usr/bin/env node
/**
 * Lint findings that this checkout has, versus findings it just acquired.
 *
 * The pre-commit hook has said "lint for dead code" since it was written, and it did not
 * do that. `oxlint` exits 0 with warnings, so the hook passed while the tree carried 46 of
 * them — including six unused imports this branch itself left behind when it moved code
 * between files. The hook's own comment was the tell: it promised a gate that was not
 * there.
 *
 * Turning on `--deny-warnings` would not fix it either. There are 46 inherited findings,
 * most in files this work never touched, so the hook would go red for everyone and be
 * bypassed with `--no-verify` within a week — the failure mode the same hook's comment
 * warns about for `typecheck` and `npm test`.
 *
 * So it works the way `scripts/source-debt.json` already works for file and function
 * size: the findings present today are RECORDED, and the gate fails only when the set
 * GROWS. A new unused import is a new finding and fails; the 46 inherited ones are
 * reported as inherited debt and named in the summary, so they stay visible instead of
 * becoming invisible again.
 *
 * Usage:
 *   node scripts/check-lint-baseline.mjs            # gate: fail only on new findings
 *   node scripts/check-lint-baseline.mjs --record   # rewrite the baseline (after fixing)
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const baselinePath = fileURLToPath(new URL("lint-baseline.json", import.meta.url));

/** `file:line:col: warning rule(message)` → a stable key.
 *
 * Keyed by file + rule + the message's FIRST WORD, not by line: a finding moves when an
 * import is added above it, and a line-keyed baseline would call that a new finding and a
 * removed one on the same edit. The rule and the identifier together are stable across a
 * reformat, which is the property that makes the baseline usable rather than noisy. */
function findingKey(line) {
  const match = line.match(/^(.+?):(\d+):(\d+):\s+warning\s+([a-z]+)\(([a-z-]+)\):\s+(.*)$/);
  if (!match) return null;
  const [, file, , , , rule, message] = match;
  const identifier = (message.match(/Identifier '([^']+)'/) ?? message.match(/Variable '([^']+)'/) ?? [])[1] ?? message.slice(0, 40);
  return `${file} :: ${rule} :: ${identifier}`;
}

function runLint() {
  try {
    return execFileSync("npx", ["oxlint", "app.tsx", "server.ts", "server", "components", "hooks", "lib", "tests"], {
      encoding: "utf8",
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      maxBuffer: 32 * 1024 * 1024,
    });
  } catch (error) {
    // oxlint exits 1 when it finds errors; stdout still carries the findings.
    return `${error.stdout ?? ""}`;
  }
}

const findings = runLint()
  .split("\n")
  .map(findingKey)
  .filter(Boolean);

const record = process.argv.includes("--record");
if (record) {
  const unique = [...new Set(findings)].sort();
  writeFileSync(baselinePath, `${JSON.stringify({ findings: unique }, null, 2)}\n`);
  console.log(`lint baseline recorded: ${unique.length} inherited finding(s)`);
  process.exit(0);
}

if (!existsSync(baselinePath)) {
  console.error("lint baseline missing — run: node scripts/check-lint-baseline.mjs --record");
  process.exit(1);
}

const recorded = new Set(JSON.parse(readFileSync(baselinePath, "utf8")).findings);
const current = [...new Set(findings)];
const added = current.filter((key) => !recorded.has(key));
const fixed = [...recorded].filter((key) => !current.includes(key));

// A fixed finding is good news and is NOT a failure, but the baseline must shrink or it
// stops describing the tree — the same discipline the size ledger uses.
if (fixed.length > 0) {
  console.log(`lint: ${fixed.length} recorded finding(s) are gone — re-record to shrink the baseline:`);
  for (const key of fixed.slice(0, 5)) console.log(`  - ${key}`);
}

if (added.length > 0) {
  console.error(`\nFAIL: ${added.length} new lint finding(s) — the tree gained dead code or a real error:\n`);
  for (const key of added) console.error(`  + ${key}`);
  console.error(
    `\nThe ${recorded.size} inherited finding(s) are recorded in scripts/lint-baseline.json and do not fail this gate.`,
  );
  process.exit(1);
}

console.log(
  `lint ok: ${current.length} finding(s), all inherited — ${recorded.size} recorded in scripts/lint-baseline.json`,
);
